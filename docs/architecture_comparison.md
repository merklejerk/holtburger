# Core Architecture Comparison: Pre-Refactor vs. Post-Refactor

This document provides an objective and critical comparison of the `holtburger` architecture before and after the major core refactor outlined in `docs/plans/core-architecture-refactor.md`. The analysis focuses on how the core engine (`holtburger-core` / `holtburger-world`) interacts with the client (`holtburger-cli`), evaluating both architectures across several key software engineering dimensions.

## 1. Architectural Overview

### Pre-Refactor Architecture (The Monolith & Duplicated State)
Prior to the refactor, `holtburger-core` was a monolithic crate responsible for networking (`session`), game state management (`world`), and client orchestration (`client`). 

The interaction between the core engine and the CLI was driven by a **Producer-Only Event Stream**. The core engine would broadcast heavy state payloads via `ClientViewEvent` (e.g., `EntityUpserted { entity: Box<Entity> }`, `PlayerStatsSkillsUpdated { attributes: ..., skills: ... }`). 

Consequently, the CLI was forced to maintain a parallel, duplicated representation of the world state in its own `GameData` struct (e.g., `entities: HashMap<Guid, Entity>`, `inventory: HashSet<Guid>`, `attributes`, `vitals`). The UI had to manually process incoming events to keep its local cache synchronized with the core engine.

### Post-Refactor Architecture (Modular Crates & Shared State)
The refactored architecture breaks the monolith into focused crates: `holtburger-session` (pure networking), `holtburger-world` (pure state management), and `holtburger-core` (client orchestration).

The interaction model has shifted to **Semantic Notifications + Shared State**. `WorldState` now stores entities as `Arc<Entity>`, enabling cheap, thread-safe sharing. `ClientViewEvent` has been redesigned to emit lightweight, semantic notifications (e.g., `EntitySpawned { guid: Guid }`, `PlayerCharacterStatsUpdated`). 

The CLI's `GameData` has been gutted of duplicated state. It now holds an `Arc<RwLock<WorldState>>` and employs a **True Pull-Based Rendering** model, querying the shared state directly during the render frame via helper methods like `with_world`.

### 1.1 Workflow & Code Illustration

To make this concrete, let's look at how an entity update (e.g., picking up an item) flows through both architectures.

**Pre-Refactor Workflow (The "Push & Duplicate" Model)**
1. **Core Mutation:** The core engine receives a network packet, updates its internal `WorldState`, and broadcasts a heavy event containing a full clone of the entity:
   ```rust
   // holtburger-core
   client_view_event_tx.send(ClientViewEvent::EntityUpserted { 
       entity: Box::new(entity.clone()) 
   });
   ```
2. **Client Event Handling:** The CLI receives this event in its update loop. It must manually inspect the entity's properties to maintain its own relational state (like inventory and equipment HashSets):
   ```rust
   // holtburger-cli (Pre-refactor)
   pub fn update_inventory_and_equipment(&mut self, entity: &Entity) {
       let guid = entity.guid;
       // The client has to duplicate the logic of figuring out what an inventory is!
       if let Some(cid) = entity.container_id() && cid == player_guid {
           self.game_data.inventory.insert(guid);
       }
       self.game_data.entities.insert(guid, entity.clone());
   }
   ```
3. **Client Rendering:** The UI renders using its local `self.game_data.inventory` and `self.game_data.entities`.

**Post-Refactor Workflow (The "Notify & Pull" Model)**
1. **Core Mutation:** The core engine updates the shared `WorldState` (using `Arc::make_mut` to safely mutate the entity) and broadcasts a lightweight semantic event:
   ```rust
   // holtburger-core
   client_view_event_tx.send(ClientViewEvent::EntityUpdated { guid });
   ```
2. **Client Event Handling:** The CLI receives the event and simply marks the UI as needing a redraw. It does *not* update any local game state, because it doesn't have any.
3. **Client Rendering:** During the render frame, the CLI locks the world state and queries the data directly using encapsulated helper methods provided by the core:
   ```rust
   // holtburger-cli (Post-refactor)
   let inventory_items: Vec<Arc<Entity>> = game.data.with_world(|w| {
       // The core library handles the logic of what constitutes an inventory
       w.iter_inventory().filter_map(|guid| w.get_entity(guid)).collect()
   });
   // Render the items directly from the Arc pointers...
   ```

---

## 2. In-Depth Comparison

### 2.1 State Management & Data Flow

**Pre-Refactor:**
- **Duplication:** State was duplicated across the core engine and the UI. Every time an entity moved or a stat changed, the entire `Entity` or stat block was cloned, boxed, and sent across a channel.
- **State Drift:** The UI was responsible for interpreting events and updating its local cache (e.g., `update_inventory_and_equipment`). If the UI's event handling logic had a bug or missed an edge case, its state would drift from the core engine's ground truth, leading to visual bugs or invalid commands.
- **Heavy Payloads:** Events like `EntityUpserted` carried massive payloads, putting unnecessary pressure on the memory allocator and the event channel.

**Post-Refactor:**
- **Single Source of Truth:** `holtburger-world` is the undisputed owner of the game state. The UI holds zero duplicated game state.
- **Pull-Based Rendering:** The UI reacts to lightweight notifications (e.g., "Entity X moved") by simply knowing that its view is dirty. During the render frame, it locks the `WorldState` briefly to pull exactly the data it needs.
- **Elimination of Drift:** Because the UI renders directly from the core's state, state drift is structurally impossible. What the engine sees is exactly what the UI renders.

### 2.2 Idiomatic Rust & Memory Efficiency

**Pre-Refactor:**
- **Excessive Cloning:** The architecture relied heavily on `.clone()` and `Box::new()` to pass state across thread boundaries. This is an anti-pattern in Rust for high-frequency updates (like physics ticks or movement).
  ```rust
  // Pre-refactor: Cloning the entire entity just to notify the UI it moved
  client_view_event_tx.send(ClientViewEvent::EntityUpserted {
      entity: Box::new(entity.clone()),
  });
  ```
- **Value Semantics for Entities:** Entities were treated as values rather than shared resources, which is inefficient for a game engine where multiple systems (physics, rendering, AI) need to reference the same object.

**Post-Refactor:**
- **Copy-on-Write (CoW) with `Arc`:** `EntityManager` now stores `Arc<Entity>`. When the UI needs to reference an entity, it simply clones the `Arc` (a cheap atomic increment). When the core engine needs to mutate an entity, it uses `Arc::make_mut`, which safely clones the underlying data *only* if there are other active references.
  ```rust
  // Post-refactor: Safe, efficient mutation using Arc::make_mut
  pub fn get_mut(&mut self, guid: impl Into<Guid>) -> Option<&mut Entity> {
      self.entities.get_mut(&guid.into()).map(Arc::make_mut)
  }
  ```
- **Lock Scoping:** The use of `Arc<RwLock<WorldState>>` is idiomatic for shared state, provided lock contention is managed. The UI only holds the read lock long enough to extract the `Arc` pointers or primitive values it needs, dropping the lock before performing expensive rendering operations.

### 2.3 Maintainability, Encapsulation, & Duplication of Work

**Pre-Refactor:**
- **Tangled Domains:** Networking logic, state mutation, and client orchestration were tightly coupled within `holtburger-core`. Changes to the UDP session logic could inadvertently impact world state management.
- **Leaky Abstractions & Duplicated Effort:** The UI had to understand the intricate details of how entities related to each other. For example, the CLI had to manually manage `inventory` HashSets based on `container_id` properties, track equipment slots, and manage vendor/trade states. This meant the client was doing the exact same work the core library was doing. If we built a 3D client, we would have to rewrite all of this complex state-management logic again.
  ```rust
  // Pre-refactor CLI: Duplicating core logic to track equipment
  if let Some(pguid) = pguid && entity.wielder_id() == Some(pguid) {
      let mask = entity.wield_location();
      if mask.is_empty() {
          game.data.equipment.remove(&guid);
      } else {
          game.data.equipment.insert(guid, mask);
      }
  }
  ```

**Post-Refactor:**
- **Strict Crate Boundaries:** The split into `session`, `world`, and `core` enforces strict separation of concerns. `holtburger-world` knows nothing about UDP packets, and `holtburger-session` knows nothing about entities.
- **Encapsulated Logic & Centralized Work:** The UI no longer needs to understand how to construct an inventory or manage trade state. It simply calls `world.iter_inventory()` and receives an iterator of `Arc<Entity>`. The complex logic of property resolution, entity relationships, and game rules is fully encapsulated within `holtburger-world`. This guarantees that any future client (like a 3D engine) gets all this logic "for free" without having to reinvent the wheel.
  ```rust
  // Post-refactor Core: The logic lives in the core library where it belongs
  fn iter_equipment(&self) -> Box<dyn Iterator<Item = Guid> + '_> {
      Box::new(
          self.entities.iter()
              .filter(|e| !e.as_ref().equipped_slots().is_empty())
              .map(|e| e.guid),
      )
  }
  ```

### 2.4 Testability

**Pre-Refactor:**
- **Integration-Heavy Testing:** Testing world state mutations often required spinning up a mock client or feeding raw network messages through the entire pipeline, making tests brittle and slow.
- **UI Testing Complexity:** Testing the UI required simulating the entire event stream to build up the local `GameData` cache before assertions could be made.

**Post-Refactor:**
- **Isolated Unit Testing:** `holtburger-world` can be tested in complete isolation. We can instantiate a `WorldState`, apply mutations directly, and assert the outcomes without any networking or client overhead.
- **Simplified UI Testing:** The UI can be tested by simply injecting a pre-configured `Arc<RwLock<WorldState>>`. There is no need to simulate an event stream to populate the UI's state.

### 2.5 Developer Experience (DevEx)

**Pre-Refactor:**
- **High Friction for New Features:** Adding a new piece of state (e.g., a new UI panel for a specific entity property) required:
  1. Updating the core engine to track the state.
  2. Modifying `ClientViewEvent` to include the new state.
  3. Updating the core client to emit the event.
  4. Adding a field to the UI's `GameData`.
  5. Writing a handler in the UI to process the event and update `GameData`.
  6. Finally, writing the rendering logic.

**Post-Refactor:**
- **Low Friction for New Features:** Adding a new UI feature is drastically simpler:
  1. Update the core engine to track the state (if it doesn't already).
  2. Write the UI rendering logic, pulling the data directly via `with_world`.
  *(No event plumbing or local cache management required!)*

---

## 4. Critical Re-evaluation: The Hidden Costs of Shared State

While the refactor successfully eliminated state duplication and synchronization bugs in the CLI, it introduced new architectural friction. A critical look at the "Shared State + Pull" model reveals significant trade-offs, particularly regarding Rust's ownership model and compatibility with diverse client architectures.

### 4.1 The DevEx Burden of Locks and Reference Counting
- **Fighting the Borrow Checker:** Rust's greatest strength is its strict compile-time ownership and borrowing rules. By wrapping the world in `Arc<RwLock<WorldState>>`, we have traded compile-time guarantees for runtime overhead and potential blocking. 
- **Lock Contention & Lifetimes:** Developers now have to carefully manage `RwLockReadGuard` and `RwLockWriteGuard` lifetimes. Holding a lock across an `await` point will cause `tokio::spawn` errors because the guard is `!Send`. This forces awkward code structures that didn't exist in the message-passing model.
  ```rust
  // Real example from holtburger-core/src/client/messages.rs
  // We must open a block to acquire the write lock, do synchronous work,
  // and return the action so the lock is dropped BEFORE we call .await
  let (wire_events, state_events, action) = {
      let mut world = self.world.write().unwrap();
      self.movement.handle_server_controlled_movement(*data, &mut world)?
  };

  // Lock is dropped, now we can safely await
  if let Some(msg) = action {
      self.session.send_message(&msg).await?;
  }
  ```
- **Is `Arc` Idiomatic?** While `Arc` is idiomatic for shared ownership graphs, relying on it as the primary mechanism for state distribution can feel like an "escape hatch" from designing a strict, data-oriented architecture.

### 4.2 Compatibility with ELM / The Elm Architecture (TEA)
- **The Purity Problem:** TEA (used by frameworks like Iced, Elm, and conceptually Ratatui) thrives on pure functions: `update(Message, State) -> State`. 
- **Friction:** The new architecture forces the UI to hold a reference to a mutable, external world (`Arc<RwLock>`). This breaks the purity of the UI's state machine. The UI can no longer easily implement time-travel debugging, deterministic testing, or pure state transitions because the underlying `WorldState` can mutate out from under it between frames.
  ```rust
  // Real example from holtburger-cli/src/ui/update/world.rs
  // The UI receives an event but does absolutely nothing with it,
  // because the state is hidden behind an opaque, mutable Arc<RwLock>.
  // It just implicitly triggers a redraw.
  ClientViewEvent::EntitySpawned { .. }
  | ClientViewEvent::EntityUpdated { .. }
  | ClientViewEvent::EntityMoved { .. } => {
      // World state is already updated via its own handler in core.
  }
  ```

### 4.3 Compatibility with Entity Component Systems (ECS)
- **The Cache Locality Problem:** ECS frameworks (like Bevy) achieve massive performance by owning their data and laying it out in contiguous memory arrays (Struct of Arrays / SoA). 
- **Friction:** `Arc<Entity>` is an Array of Structs (AoS) model with pointer indirection. If a Bevy client wants to render the game, it cannot simply insert an `Arc<Entity>` into its ECS without ruining cache locality. 
- **The Duplication Irony:** To make Bevy performant, the 3D client will likely have to read the `Arc<Entity>` and *duplicate* the relevant data (like Position and Mesh) into its own ECS components anyway. This means the primary benefit of the `Arc` refactor—avoiding state duplication—may be entirely moot for a high-performance 3D client.
  ```rust
  // Projection of Bevy ECS integration based on current API
  fn sync_core_to_bevy(
      core_world: Res<Arc<RwLock<WorldState>>>,
      mut query: Query<(&Guid, &mut Transform)>,
  ) {
      let w = core_world.read().unwrap();
      for (guid, mut transform) in query.iter_mut() {
          if let Some(core_entity) = w.get_entity(*guid) {
              // We are forced to duplicate the position data into Bevy's Transform component!
              transform.translation = core_entity.position.to_vec3();
          }
      }
  }
  ```

---

## 5. Brainstorming Future Architectures

Given the friction points identified in the current "Shared State + Pull" model, we need to explore alternative architectures that can satisfy the needs of both a TUI (TEA) and a 3D Client (ECS) without re-introducing the state-drift bugs of the original monolith.

### Goals Matrix
We evaluate potential architectures against the following goals:
- **No State Drift:** The client's view of the world must perfectly match the core engine.
- **No Logic Duplication:** The client should not have to reimplement game rules (e.g., "what is an inventory?").
- **TEA Compatibility:** Supports pure state transitions (no hidden mutable state).
- **ECS Compatibility:** Supports contiguous memory layouts (SoA) without forcing pointer indirection.
- **DevEx (Core):** Easy to write and maintain the core engine (no lock fighting).
- **DevEx (Client):** Easy to build UI features without massive boilerplate.

### Architecture A: The Delta-Event Stream (Push-Only, Fine-Grained)
Instead of pushing massive `Box<Entity>` clones, the core engine pushes fine-grained, semantic deltas. The core engine *already generates these internally* via `StateEvent` (e.g., `PropertyUpdated { guid, update }`, `EntityMoved { guid, pos }`). We would expose these directly to the client.

* **Workflow:** Core mutates its internal state -> Core emits `EntityMoved(Guid, Vec3)` -> Client receives event and updates its own local representation.
* **Pros:** Perfect for TEA (pure updates) and ECS (can update SoA components directly). No locks, no `Arc` overhead.
* **Cons:** Re-introduces the risk of state drift if the client misses an event or implements the update logic incorrectly. The client still has to maintain its own data structures.

| Goal | Satisfaction | Notes |
| :--- | :--- | :--- |
| No State Drift | ⚠️ Medium | Relies on perfect event handling by the client. |
| No Logic Duplication | ❌ Low | Client must still know how to apply deltas to its own state. |
| TEA Compatibility | ✅ High | Pure message passing. |
| ECS Compatibility | ✅ High | Deltas map perfectly to component updates. |
| DevEx (Core) | ✅ High | No locks, just emit events. |
| DevEx (Client) | ⚠️ Medium | Requires writing boilerplate to handle every delta type. |

### Architecture B: The ECS Core (Shared ECS)
We rewrite `holtburger-world` to use an ECS (like `hecs` or `bevy_ecs`) internally. The core engine and the client share the *same* ECS world.

* **Workflow:** Core runs systems to update the ECS -> Client runs systems to render the ECS.
* **Pros:** Solves the cache locality problem for the 3D client. Eliminates state duplication entirely.
* **Cons:** Massive rewrite of the core engine. Forces the TUI client to adopt an ECS paradigm, which is hostile to TEA/Ratatui.

| Goal | Satisfaction | Notes |
| :--- | :--- | :--- |
| No State Drift | ✅ High | Single source of truth. |
| No Logic Duplication | ✅ High | Core systems handle all logic. |
| TEA Compatibility | ❌ Low | ECS is fundamentally incompatible with pure functional UI. |
| ECS Compatibility | ✅ High | Native ECS. |
| DevEx (Core) | ⚠️ Medium | Requires paradigm shift to ECS. |
| DevEx (Client) | ⚠️ Medium | Great for 3D, terrible for TUI. |

### Architecture C: The "View Model" Projection (Hybrid)
The core engine maintains its current `Arc<RwLock>` state, but instead of forcing the client to pull raw `Arc<Entity>` pointers, the core engine provides a "View Model" API. The client requests a specific view (e.g., `get_inventory_view()`), and the core engine returns a flat, easily consumable struct containing *copies* of just the data needed for rendering.

* **Workflow:** Core mutates state -> Core emits `InventoryChanged` -> Client calls `get_inventory_view()` -> Core locks, builds a flat `Vec<ItemView>`, drops lock, and returns it -> Client renders.
* **Pros:** Hides the `Arc<RwLock>` from the client's render loop. Client doesn't need to understand entity relationships.
* **Cons:** Still involves locking. Re-introduces cloning (though only for the specific data requested, not the whole entity).

| Goal | Satisfaction | Notes |
| :--- | :--- | :--- |
| No State Drift | ✅ High | Data is pulled fresh from the source of truth. |
| No Logic Duplication | ✅ High | Core builds the views. |
| TEA Compatibility | ⚠️ Medium | Still relies on pulling, but the pulled data is pure. |
| ECS Compatibility | ⚠️ Medium | Still requires copying data into the ECS. |
| DevEx (Core) | ⚠️ Medium | Have to write and maintain View Model builders. |
| DevEx (Client) | ✅ High | Extremely easy to consume flat data structs. |

### Architecture D: The Middleware Framework (Client-Agnostic SDK)
In this model, we split the responsibilities into three distinct layers:
1. **`holtburger-protocol` / `session` (The Core API):** Purely handles UDP transport, cryptography, and parsing raw bytes into Rust structs (`GameMessage`). It has zero concept of game state.
2. **`holtburger-framework` (The Headless Client):** This crate consumes the raw `GameMessage` stream and applies the complex Asheron's Call game rules (e.g., "When a `Stackable` item is dropped on another, calculate the new stack size and destroy the source item"). However, it *does not own the data storage*. Instead, it requires the host application to provide a state backend via a trait (e.g., `trait WorldStorage: Send + Sync`).
3. **The Client UI (CLI or 3D):** The client implements the `WorldStorage` trait using its preferred paradigm (a pure `HashMap` for TEA, or an ECS `World` for Bevy), but crucially, since the framework must run asynchronously on a network thread, the storage implementation must be thread-safe (`Arc<RwLock>` or message-passing boundaries). 

* **Workflow:** 
  1. Core API parses a packet: `GameMessage::StackItems { source, target }` on the network thread (`tokio::spawn(client.run())`).
  2. Framework receives the message, validates the game rules, and calls a hook on the provided storage trait: `storage.update_stack_size(target, new_size)`.
  3. The Client's implementation of that trait safely crosses the thread boundary to update its Bevy ECS components or fire a TEA Message to the UI thread.
* **Pros:** Complete separation of concern. The UI doesn't have to decipher game rules (no logic duplication). State ownership is relinquished to the specific UI client.
* **Cons:** Hard to design properly. Complex, heavily abstracted "middleware" setups can lead to intense boilerplate and a steep learning curve. **Critically, it does not actually solve the threading/lock issue.** Because the network IO and game logic run on a background `tokio` thread, the `WorldStorage` trait implementation must inherently be `Send + Sync`. This means the client is *still* forced to use locks or channels inside its trait implementation to mutate its own UI-thread state.

| Goal | Satisfaction | Notes |
| :--- | :--- | :--- |
| No State Drift | ⚠️ Medium | The UI must implement the storage trait correctly to sync with the framework. |
| No Logic Duplication | ✅ High | Framework interprets the AC abstractions; UI only handles storage/presentation. |
| TEA Compatibility | ⚠️ Medium | The trait hook must emit a `Message` back to the UI thread, adding indirection. |
| ECS Compatibility | ⚠️ Medium | The trait hook cannot easily borrow the ECS `World` directly from a background network thread; it will likely require bridging via channels or an intermediate buffer. |
| DevEx (Core) | ❌ Low | Designing incredibly generic `WorldStorage` trait boundaries that satisfy both HashMap and ECS backends across thread boundaries is an architectural nightmare. |
| DevEx (Client) | ⚠️ Medium | High flexibility, but implementing a thread-safe `WorldStorage` adapter for an ECS is highly non-trivial. |

### Architecture E: The "Remote ECS" (Command/Delta Pattern with Server-Side ECS)
If we eventually want the client to be a Bevy 3D game, we could lean entirely into the ECS paradigm, but keep it cleanly separated across the thread/crate boundary via a standard networking pattern (Snapshot + Deltas). `holtburger-core` internally runs an ECS (like Architecture B). However, instead of trying to *share* that ECS in memory (which requires locks), it acts like a local, authoritative server. It produces an ECS-agnostic stream of Commands/Deltas. The Bevy client consumes those deltas and applies them to its *own* separate ECS world on the main thread.
*(Note: Bevy's `bevy_replicon` or similar crates use this exact pattern).*

* **Workflow:** Network thread receives UDP packet -> Core ECS systems process the logic (calculating physics, inventory stacking) -> Core systems bundle changes into a `Vec<ComponentUpdate>` -> Network thread pushes updates through a channel -> Main UI thread consumes channel and applies `ComponentUpdate`s to the Bevy `World`.
* **Pros:** Peak performance for the 3D client (no locks, pure SoA memory). Core development is highly ergonomic because ECS handles complex relational logic beautifully. Solves the thread boundary cleanly via message passing.
* **Cons:** The TUI client would be severely disadvantaged. It would have to either adopt a heavy ECS just to render text, or maintain a massive state machine to handle the raw `ComponentUpdate` stream (basically re-introducing state duplication and drift risk for the TUI).

| Goal | Satisfaction | Notes |
| :--- | :--- | :--- |
| No State Drift | ⚠️ Medium | Client must map component updates accurately. |
| No Logic Duplication | ✅ High | Core ECS handles all game rules. |
| TEA Compatibility | ❌ Low | The TUI would be force-fed ECS component data. |
| ECS Compatibility | 🌟 Perfect | Designed specifically for this pipeline. |
| DevEx (Core) | ✅ High | Writing game logic in ECS is highly ergonomic. |
| DevEx (Client) | ⚠️ Split | Amazing for 3D Client; Terrible for TUI Client. |

## 6. Initial Hypothesis: Architecture C

The Phase 1-5 refactor was a necessary stepping stone. It successfully decoupled the monolithic crate structure and solved immediate, crippling bugs related to state drift in the CLI. For a TUI application, the `Arc<RwLock>` pull-based model is highly pragmatic and drastically reduces boilerplate.

However, as we look toward building a 3D client (ECS) or alternative UIs (TEA), the shared-state model reveals itself as a potential local maximum. The reliance on `Arc` and `RwLock` introduces runtime friction and dictates memory layout in a way that is hostile to data-oriented design. 

**Initial Hypothesis: The "View Model" Projection (Architecture C)**

Based on the brainstorming matrix, we initially hypothesized that **Architecture C** presented the strongest compromise between the immediate needs of the TUI and the future needs of a 3D client. 

* **Why not A or D?** Relying on the client to rebuild state via a delta event stream or trait hooks inevitably reintroduces state drift bugs and logic duplication, which was the exact reason we initiated this refactor.
* **Why not B or E?** Forcing an ECS paradigm onto the core or TUI is a massive rewrite that prematurely optimizes for a 3D client that doesn't exist yet, severely punishing the DevEx of our only working client (the CLI).
* **The Sweet Spot:** Architecture C gives us the best of both worlds. The core retains its centralized logic and single source of truth (solving state drift), but by hiding the `Arc<RwLock>` behind View-Model builder methods, we insulate the clients from lock contention during rendering. The TUI gets flat, pure structs it can use safely, and a future Bevy client can ingest those flat structs to construct its initial ECS components without fighting pointer indirection. 

With this hypothesis, we proceeded to a deeper feasibility assessment of Architecture C, which ultimately revealed critical flaws in this assumption.

## 7. Feasibility Assessment: Architecture C (The False Summit)

As we attempted to transition towards Architecture C, we identified where this pattern represents a natural evolution of the current codebase and where it might introduce unexpected overhead. Our current layout in `holtburger-cli` heavily leverages `ratatui`, which sits awkwardly between immediate-mode and retained-mode UI.

### Where the View Model Pattern Fits Naturally

1. **Transactional and Session-Based Data (Trade, Vendor, Chat)**
   The codebase already manages states like `TradeState` and `VendorState` via `.get_trade()` and `.get_vendor()`. Extracting these into explicit snapshots (e.g., `TradeView`) is almost trivial. The logic to compute what is being offered and the current balance is currently tangled in UI render loops. Moving this into a `get_trade_view()` builder on the core side cleans up the TUI and guarantees pure rendering without locks.
   
   *Current Problem (apps/holtburger-cli/src/ui/widgets/dashboard/tabs/trade/render.rs):*
   ```rust
   // UI code performs deep business logic directly inline during rendering
   let render_data = game.data.with_world(|w| {
       if let Some(vendor) = w.get_vendor() {
           // ... (extract items)
           let base_value = m.properties.ints.get(&PropertyInt::Value).unwrap_or(0) as f32;
           let price = ((sell_rate * base_value) - VENDOR_CEIL_OFFSET)
               .ceil()
               .max(DEFAULT_PRICE as f32) as u32;
           // ...
   ```
   *Architecture C Solution:* The core would provide a `VendorView` snapshot where `price` is already computed by the core game rules, leaving the UI to strictly handle presentation.

2. **Player Vitals and Status HUD**
   Widgets like `hud/vitals.rs` and `hud/status.rs` currently query `w.current_server_time()`, `w.get_player_pos()`, and iterate through attributes. Extracting this out into a flattened `PlayerStatusView` (containing native types, Strings, and `Vec3`s) is extremely cheap and perfectly encapsulates all required data for the HUD in one clean lock-acquire phase, rather than peppering the ratatui pass with sequential reads of the `WorldState`.

3. **TEA-Compatible Pure Render Loops**
   Currently, Ratatui's `f.render_widget` calls are trapped inside `game.data.with_world(...)` closures, meaning we continuously hold an `RwLockReadGuard` around the entire screen paint layout computation. By shifting to View Models, `holtburger-cli` can acquire the view structure at the start of the frame, instantly drop the lock, and pass a purely immutable, un-locked `View` object down the Ratatui component tree. This fully un-blocks the background `tokio` networking runtime from mutating state during long layout passes.

### Where the View Model Pattern Might Struggle

1. **High-Frequency, High-Volume Spatial Rendering (The 3D Client Problem)**
   While fetching a snapshot view works great for 100 inventory items, building a 3D scene requires querying the `Transform` and `Mesh` ID of *every visible entity*. If the Bevy client calls `get_scene_view()` 60 times a second, creating a `Vec<EntityView>` of 1,000+ entities is a massive heap allocation that actively defeats Rust's performance benefits. 
   *Mitigation:* The View Model pattern will likely need a paging/streaming approach (e.g., spatial partitioning views) or retaining some `Arc<Entity>` usage for heavy static data, only flattening dynamic properties.

2. **Recursive Logic and "Fat" Views**
   Some items in AC contain nested inventory structures. A naive `InventoryView` might accidentally crawl the entire nested tree and build a massively deep struct, or worse, perform complex tree traversals every frame. Striking the balance between "Return all the data the UI needs" and "Don't perform expensive graph traversals on every view request" will be challenging.
   
   *Current Ground Truth (crates/holtburger-world/src/context.rs):*
   ```rust
   // This expensive recursive logic should NOT run every time a View is requested!
   fn is_attuned_sticky_recursive(&self, guid: Guid) -> bool {
       if e.is_attuned_sticky() { return true; }
       for other_guid in self.iter_inventory() {
           if let Some(other) = self.get_entity(other_guid)
               && other.container_id() == Some(guid)
               && self.is_attuned_sticky_recursive(other_guid) {
               return true;
           }
       }
       false
   }
   ```

3. **Stale Data / Action Verification**
   If the GUI operates purely on a snapshot (`InventoryView`), it increases the risk of "phantom clicks". Consider the flow: Core builds `InventoryView` -> Lock is dropped -> Network packet arrives and item is dropped -> User clicks action on the Stale item in UI.
   Because the UI handles pure structs instead of direct `Arc<Entity>` references, any user interaction must carefully re-validate the target `Guid` against the true `WorldState` before issuing commands. 
   
   *Current Ground Truth (apps/holtburger-cli/src/ui/widgets/dashboard/input.rs):*
   ```rust
   // The UI currently validates existence BEFORE generating the Action Event
   (Action::Use, CommandTarget::Entity(guid)) => game.data.with_world(|w| {
       if let Some(e) = w.entities.get(*guid) { // Validates item exists
           if e.flags.intersects(ObjectDescriptionFlag::HEALER) {
               Some(UIEffect::Heal(*guid))
           } else {
               Some(UIEffect::Command(ClientCommand::Use(*guid)))
           }
       } else { None } // Silently fails if item is gone
   }),
   ```
   *Challenge:* When `with_world` lock is removed, the core library `holtburger-core` will suddenly have to assume the burden of validating these async drop/use commands before firing them via UDP, moving failure handling (like telling the player "That item is gone") out of the UI and into the networking layer.

### The Core Bloat Problem & Event-Sourced Projections

A critical flaw in naively applying Architecture C is the assumption that `holtburger-core` should be responsible for defining structures like `InventoryView` or `PlayerStatusView`. 
1. **Over-fetching:** Individual widgets rarely need a *full* entity snapshot. A minimap widget only needs `(Guid, Vec3, is_hostile)`, while an inventory widget needs `(Guid, Name, Icon)`. If the core attempts to provide a one-size-fits-all `EntitySnapshot`, it wastes CPU/memory copying dozens of unused properties.
2. **API Bloat:** It is highly presumptuous to expect the core game logic crate to anticipate and author builder methods for every conceivable UI layout, TUI widget, or 3D client rendering pass. If `holtburger-core` implements `build_minimap()`, it violates separation of concerns.

**Idiomatic Solution: Client-Owned Projections via Event Sourcing**
Because we cannot let the client pass arbitrary closures into `with_world` (which blocks the `RwLock`), and because the core cannot know what views the client needs (API bloat), the only true resolution that satisfies all constraints is for the client to build its own relational projections **reactively** based on semantic events, rather than pulling from a shared lock.

Instead of Architecture C being pure "Core builds the View," Architecture C should mean "The Client maintains its own optimized Views by listening to the Core." The `WorldState` lock is avoided entirely for rendering.

*Example Pattern (Client-Side Projection):*
```rust
// 1. Client purely owns its specific render models (No core involvement)
struct MinimapBlip { x: f32, y: f32, is_hostile: bool }
struct MinimapProjection {
    blips: HashMap<Guid, MinimapBlip>,
}

// 2. Client receives semantic state-deltas from the core engine's channel
// These updates happen strictly outside of any RwLock!
impl MinimapProjection {
    fn handle_event(&mut self, event: &StateEvent) {
        match event {
            StateEvent::EntityMoved { guid, pos } => {
                if let Some(blip) = self.blips.get_mut(guid) {
                    blip.x = pos.x;
                    blip.y = pos.y;
                }
            },
            StateEvent::EntityDespawned { guid } => {
                self.blips.remove(guid);
            }
            // ...
        }
    }
}

// 3. The UI render frame purely borrows the client's local projection.
// Zero interactions with holtburger-core. Zero locks.
render_minimap_widget(&minimap_projection);
```
**Conclusion: The Inevitable Convergence on Architecture A**
By attempting to "fix" Architecture C (resolving the API Bloat of core-defined views, and resolving the Lock Contention of client-defined closures), we have naturally and inevitably arrived at **Architecture A: The Delta-Event Stream**. 

If the core provides fine-grained deltas (`StateEvent`), and the client uses them to maintain its own decoupled representations of the world, that is literally the definition of Architecture A. 

Therefore, this feasibility assessment proves that **Architecture C is a false summit**. It either requires tightly coupling the core to UI needs, or it mathematically reduces into Architecture A to maintain separation of concerns. 

**Revised Recommendation:** We must officially pivot our target architecture from C to **Architecture A**. The Monolith refactor phase was not a waste—it successfully purged the duplicated "god objects" (the massive `Box<Entity>` clones). Moving forward, the UI should not use `Arc<RwLock>` to pull data. Instead, `holtburger-core` should expose a rich, pure `StateEvent` stream. The TUI (TEA) and the future 3D Client (ECS) will consume these lightweight deltas to fluidly update their own highly-specialized, local UI projections (like `MinimapBlip` HashMaps or Bevy `Transform` components) completely lock-free.

---

## 8. Feasibility Assessment: Architecture A (The Delta-Event Stream)

In turning our focus to Architecture A as the primary path forward, we abandon the `Arc<RwLock<WorldState>>` completely. Instead, `holtburger-core` pushes a stream of fine-grained `StateEvent`s directly to the client. The client builds exactly what it needs (Projections), never locking the core threads, and never duplicating irrelevant data.

### Where Architecture A Fits Naturally

1. **ECS/3D Client Compatibility (The "Holy Grail")**
   The strongest validation of Architecture A is that it perfectly matches the idiomatic input of an Entity Component System like Bevy. 
   
   *Current internal StateEvents (crates/holtburger-world/src/lib.rs):*
   ```rust
   pub enum StateEvent {
       EntityMoved {
           guid: Guid,
           pos: WorldPosition,
       },
       EntityVectorUpdated {
           guid: Guid,
           velocity: Vector3,
           omega: Vector3,
       }
   ```
   A future `holtburger-bevy` client can blindly map these events straight into ECS components (`commands.entity(guid).insert(Transform::from(pos))`). Zero logic duplication, zero lock contention, and pure contiguous memory layout.

2. **Decoupled Main Loops**
   By severing the `Arc<RwLock>`, `holtburger-cli`'s UI thread and `holtburger-core`'s network/Tokio thread are mathematically isolated. The network thread can process thousands of high-frequency UDP movement packets from the ACE server without ever blocking because Ratatui is busy rendering a complex TUI table. 

### Where Architecture A Will Struggle (And Mitigation Strategies)

1. **The "Cold Start" (State Hydration) Problem**
   An event stream is seemingly useless if you "miss" the beginning of the stream. If a developer thinks of the TUI tabs as independent web-apps that "mount" when opened, they might assume opening the `TradeTab` requires querying the core engine for a massive `TradeSnapshot` because they missed the events indicating what is on the vendor.
   
   *Mitigation: Continuous Root Projection*
   The solution is that the client does not wait for a UI tab to open before it starts projecting state. The client's root application state acts as a continuous consumer of the message stream. 
   When the core fires a `StateEvent::VendorApproach`, the root UI state receives it and builds the `VendorProjection` in the background. If the user later presses a hotkey to switch to the `TradeTab`, the tab simply renders the *already hydrated* projection that the root app has been quietly building via the synchronous event loop. As long as the event consumer and the UI components share the same synchronous thread (like in standard TEA designs), there is zero risk of dropped events or race conditions.

2. **The "Derived Game Rules" / Logic Duplication Crisis**
   This is the most dangerous aspect of Architecture A. AC is a highly relational game. A simple question like "Can I sell this item?" is absurdly complex.
   
   *Current Ground Truth (crates/holtburger-world/src/context.rs):*
   ```rust
   fn can_sell_to_vendor(&self, guid: Guid) -> bool {
       // 1. Is it empty? (Checks all 100 inventory items to see if they belong to this container)
       if !self.is_container_empty(guid) { return false; }
       // 2. Does the vendor accept this item type mask?
       if (itype.bits() & vendor.merchandise_item_types) == 0 { return false; }
       // ...
   }
   ```
   If the Client only has localized Projections (e.g., an `InventoryItem` and a `Vendor` widget), who evaluates `can_sell_to_vendor`? 
   * If the Core evaluates all flags eagerly behind the scenes and pushes them as `EntityFlagUpdated` events, the Core's CPU is completely cooked doing a combinatorial explosion of N*M checks every tick.
   * If the Client evaluates it, we have violated DRY and created massive Logic Duplication. The TUI and Bevy client would have to rewrite hundreds of rules.

   *Mitigation: Pure Rules via Shared Traits.* 
   Instead of eager core evaluation, the logic must remain purely functional and generic in the core library, but *executed on-demand by the client* using the client's local projection data.
   
   ```rust
   // 1. Core library defines the TRAIT and the PURE LOGIC
   pub trait InteractorContext {
       fn is_container_empty(&self, guid: Guid) -> bool;
       fn get_vendor_mask(&self) -> u32;
   }
   
   // The pure rule is owned by holtburger-core (or a new holtburger-rules crate)
   pub fn can_sell_to_vendor(ctx: &impl InteractorContext, guid: Guid) -> bool {
       // Same logic as before, but operating on an abstract Trait context
       if !ctx.is_container_empty(guid) { return false; }
       /* ... */
   }

   // 2. Client UI Projection implements the trait
   impl InteractorContext for UiProjection {
       fn is_container_empty(&self, guid: Guid) -> bool {
           self.blips.values().all(|b| b.container != Some(guid))
       }
   }

   // 3. UI thread calls the pure core function synchronously, on its own data!
   let is_sellable = holtburger_world::rules::can_sell_to_vendor(&ui_projection, selected_guid);
   ```
   This is the Holy Grail: `holtburger-core` maintains total authority over Asheron's Call business logic (No Duplication), but the UI calculates exactly what it needs, exactly when it needs it (No Eager Evaluation CPU Bloat), using its locally-owned data (No Shared Locks).

### A New Workflow Standard
By adopting Architecture A with Pure Rules, the workflow for building new features changes dramatically:
1. **Core:** Add parsing for the new UDP Message.
2. **Core:** Mutate `WorldState` and emit primitive `StateEvents` (e.g., `EntitySpawned`).
3. **Core:** Extract derived rules into pure traits/functions (e.g., `pub fn is_sellable(ctx: &impl InteractorContext)`).
4. **Client:** The UI Projection updates its localized HashMap based solely on the incoming `StateEvent` stream.
5. **Client:** The Ratatui (or Bevy) loops render purely from the local, unlocked UI Projection, calling the Core's pure rule functions on-demand to handle interactive states like hover/selection. 

### Division of Responsibilities (Architecture A)

To successfully implement Architecture A, the boundary between `holtburger-core` and the client applications (`holtburger-cli`, `holtburger-bevy`) must be strictly maintained.

#### `holtburger-core` (The Authoritative Engine)
The core library acts as a headless game server running locally on a background Tokio task. It is the sole custodian of truth and game logic.
* **Network Mutator:** It is the only crate allowed to construct, send, and parse UDP packets (`holtburger-session` handles the transport, but `core` orchestrates it).
* **State Custodian:** It maintains the full, complex relational graph of the game world (`WorldState`) in memory. 
* **Rule Evaluator:** It physically owns the pure functions that define Asheron's Call logic (e.g., `can_equip_item()`, `calculate_damage_resist()`).
* **Event Broadcaster:** When its internal `WorldState` mutates (usually in response to a UDP packet or an internal tick), it synthesizes those complex state changes into a flat stream of purely descriptive, semantic `StateEvent` primitives. It pushes these events down a channel to any listening clients.

#### The Client (`holtburger-cli` / ECS)
The client is a purely reactive presentation layer. It does not own the truth; it only visualizes a shadow of it.
* **Event Consumer:** The root application loop continuously drains the `StateEvent` channel provided by the core.
* **State Projector:** It interprets incoming events (e.g., `EntitySpawned`) to update its own highly-specialized, local UI representations (e.g., adding a `ListItem` struct to a `Vec`, or spawning a Bevy `Entity` with a `Transform` component).
* **Pure Renderer:** It renders the screen using *only* its local projections. It never attempts to read `.with_world()` or acquire an `RwLock`.
* **Action Issuer:** When a user interacts with the UI, the client translates that input into an abstract `ClientCommand` (e.g., `DropItem(Guid)`). It pushes this command up a channel to the `holtburger-core`. It does *not* assume the command succeeds—it waits for the resulting `StateEvent` back from the core before updating the UI projection.
* **On-Demand Rule Caller:** For interactive UI states (like highlighting an item green if it can be sold), the client invokes the pure rule traits exposed by `holtburger-core`, feeding them its own local projection data as the context.

### Clarification: Authoritative State vs. Client Projections
A valid question arises: if the client implements `InteractorContext` to evaluate rules locally, isn't the client just rebuilding the entire `WorldState` anyway? What is the core actually doing?

The key distinction is **Authoritative Truth (The Database)** vs. **Client Projections (The Materialized View)**:

1. **The Core's `WorldState` (The Database):** 
   The core engine stores the *complete, lossless* relational data received from the UDP stream. This includes hidden physics fields, obscure property bitmasks, unknown items sitting 500 meters away, and backend sequence numbers. The core *must* maintain this massive graph to correctly serialize outgoing network packets to the ACE Server, apply predictive physics movement, and maintain the complex state transitions required to parse ongoing packets correctly.

2. **The Client's Projections (The Materialized View):** 
   The client only stores *lossy, highly-filtered* snapshots of exactly what it needs to render the current screen. If the user doesn't have the "Debug Properties" window open, the client's event loop simply ignores incoming property events, letting them drop on the floor. It might only track 50 items in a `TradeTab` slice, while the Core tracks the 5,000 entities actively spawned in the cell radius.

**The Role of the `InteractorContext` Trait:**
This trait is simply a pure data lens. 
* The `holtburger-core` library implements `InteractorContext` for its massive `WorldState` so it can provide baseline, headless evaluation of pure rules if a downstream client explicitly requests it (e.g., a Bot client that lacks a UI Projection). 
* The client UI *also* implements `InteractorContext` for its tiny, localized `UiProjection` struct so it can answer "Can I drop this?" quickly to gray out a button on the UI frame, using only the partial data it chose to retain. The client answers based on its specific shadow of reality; the core holds actual reality.

### Handling Transactional Sessions (Trade, Vendor)
A logical question when splitting responsibilities is: *Who tracks high-level "sessions" like an active Trade or Vendor interaction? Is that a UI concept or a Core concept?*

**Trade is an Authoritative Game State (Core-Owned)**
While "opening a trade window" feels like a UI concern, the actual *trade session* is a strict, server-orchestrated transaction. The `holtburger-core` **must** track the active `TradeState` (who you are trading with, what items are locked in the trade window, and who has accepted). 

If the core did not track this:
1. It would not structurally understand the server's inbound `TradeCompleted` or `TradeItemRejected` network packets, making it impossible to accurately mutate the player's physical inventory graph. (The core cannot deserialize contextual game state without tracking the session).
2. It could not provide the generic Asheron's Call pure rules (e.g. `is_item_tradeable_currently()`) to the `InteractorContext`. The UI uses these pure rules strictly to draw the screen correctly (e.g. graying out buttons for locked items), *not* to enforce server security.
3. Crucially, **the core does NOT validate out-bound actions for security.** If the client sends a `ClientCommand::AcceptTrade`, the core should just serialize it and send it to the ACE Server. The ACE Server is the ultimate authority. The core only tracks the trade state to understand the *in-bound* narrative.

**The Client's "Window" (Client-Owned)**
The UI Client treats the Core's trade session as just another state to project.
* The Core receives a UDP `TradeRequested` packet -> Updates its backend `WorldState` -> Emits `StateEvent::TradeSessionStarted(PartnerGuid)`.
* The Client receives `TradeSessionStarted` -> Updates its local UI state `active_window = Window::Trade` -> Starts projecting `TradeItemAdded` events onto a visual right/left split-pane struct.

The Core enforces the *rules of the transaction*; the Client enforces the *pixels on the screen*.

### Technical Gotchas & Implementation Constraints

While Architecture A cleanly solves the threading and duplication problems, strictly auditing the data mechanics reveals a few potential pitfalls. To ensure the implementation actually jives with the demands of an Asheron's Call client, we must adhere to these specific constraints:

#### 1. The "Lossy Projection" vs. `InteractorContext` Trap
We stated earlier that the client can maintain "lossy" projections—if it doesn't need to render a property, it can simply let the event drop on the floor. However, this creates a contradiction: if that dropped property is required by a pure game rule (e.g., `can_sell_to_vendor`), the UI cannot satisfy the `InteractorContext`, and the logic breaks. 
* **The Constraint:** Client Projections must be **Behavior-Complete**, not just Render-Complete. The client's `UiProjection` must retain a baseline dictionary of core game properties (values, types, flags) specifically to satisfy the `InteractorContext` trait, even if Ratatui isn't drawing them on the screen.
* **The Pattern Deviation (Debug Queries):** For massive, rarely-accessed data (like inspecting *all* raw AC properties on an entity via a "Debug View"), we do not force the client to blindly hoard that data just in case. Instead, we allow a deliberate pattern deviation: the client sends an upstream, async `ClientCommand::QueryEntityDebugInfo(Guid)` to the core. The core responds with a heavy, one-off snapshot specifically for that user-initiated debug view.

#### 2. The Physics Event Firehose
If `holtburger-core` runs predictive physics internally at 60 ticks-per-second, and emits `StateEvent::EntityMoved` for 500 monsters every tick, it will fire 30,000 events a second down an `mpsc::channel`. The UI thread might choke trying to process that many granular updates, defeating the purpose of decoupled threads.
* **The Constraint:** Architecture A only works for spatial movement if the `StateEvent` stream emits **Derivatives**, not absolutes. The core should only emit a movement event when an entity's *trajectory* changes (e.g., `StateEvent::EntityVectorUpdated { velocity, omega }`). The core does NOT send position updates every frame. The client (Bevy or CLI) receives the vector *once* and uses its own local delta-time loop to smoothly extrapolate the position.

#### 3. The "Big Bang" Boot Sequence
When an AC character logs in, the server sends a massive burst of data (full inventory, vitals, scene graph) within milliseconds. If the CLI starts the `tokio` core thread, tells it to "Login", and *then* starts up the Ratatui render loop to drain the channel, a race condition occurs. The core might spam thousands of `EntitySpawned` events into the channel before Ratatui is ready, panicking the app or blocking the core.
* **The Constraint:** Strict Pipeline Initialization. The `mpsc` receiver channel must be fully established, and the UI event-consumer loop must be actively draining the stream, *before* the network thread is ever authorized to send the initial UDP Handshake to the ACE server.

## 9. The ".old" Reality Check: A Necessary Compromise

As we codified Architecture A as the definitive target, a deep dive into the historical `.old/` codebase (the pre-refactor monolith) revealed a startling truth: **Architecture A mechanically pressures the client back into state duplication.**

By moving to Event Sourcing and avoiding the `RwLock`, the client *must* maintain its own local cache of entities to evaluate game rules (like `can_sell_to_vendor()`) and track complex graph transitions (like dropping a container with items inside it). We initially framed this as a "Trap" or a "Regression."

However, upon further reflection, we must acknowledge a hard architectural truth: **Locking a global `Arc<RwLock<WorldState>>` up to 20 times per frame to render TUI widgets is fundamentally unscalable and hostile to decoupled engine design.** 

While the "Micro-Locking" (Architecture C.1) pattern nominally works, it intimately couples the UI render loop to the core physics/network loop via a shared memory bottleneck. This completely defeats the goal of having a headless engine. If the `RwLock` is heavily contended by high-frequency UI reads, it will inevitably stall incoming UDP stream processing on the Tokio thread, causing systemic network desync.

Therefore, **we must accept Architecture A**, but we must implement it knowing we are consciously accepting the "sins" of the pre-refactor codebase, heavily mitigated by a strict, unified event boundary.

### The Accepted "Sins" (The Compromises)

#### 1. "Fat" Client Entities (State Duplication)
We abandon the fantasy of "Skinny Projections." If the UI needs to evaluate `InteractorContext` traits locally to enforce accurate interactive states (like graying out buttons), it must have access to underlying bitmasks and properties. 
* **The Compromise:** The client *will* maintain a duplicated `HashMap<Guid, Entity>`. 
* **The Mitigation:** The core lib will push flat, granular `PropertyUpdated` messages. While the client maintains a fat structure, traversing the thread boundary uses extremely lightweight delta messages, avoiding the heavy payload spam that crippled the old architecture.

#### 2. Eventual Consistency (The Phantom Click)
By relying purely on an asynchronous event stream, the UI's local projection of the world might lag milliseconds behind the absolute server truth. A user might try to interact with an item that the network thread *just* despawned.
* **The Compromise:** We accept Phantom Clicks as a reality of decoupled network programming. 
* **The Mitigation:** The UI will not proactively panic or enforce strict validation against its own cache. It simply serializes the user's intent into a `ClientCommand` and sends it upstream. The Core/Server is responsible for silently rejecting invalid actions.

### The Hard Line: The Single Event Feed

While we are willing to accept state duplication, we strictly **refuse** the most fatal trap of the `.old` codebase: Leaking stack boundaries.

In the old architecture, the CLI had to aggressively orchestrate events from completely different layers of the networking stack: `WireEvent` (raw UDP stream info), `StateEvent` (internal ECS logic), and `ClientViewEvent` (UI triggers). This meant the client had to manually perform graph reconstruction and infer intent from raw network bytes.

**The Architecture A Boundary Mandate:**
The Client must process a **single, highly-abstracted, purely-semantic feed of events** (`ClientViewEvent`) orchestrated exclusively by the Core.
* The client should never see a `WireEvent`.
* The client should blindly map `ClientViewEvent::EntityUpdated { guid, key, value }` directly into its local dictionary without having to understand Asheron's Call protocol context.
* If a complex relational change happens (e.g., a backpack is dropped), the Core *must* do the heavy lifting of resolving the graph and emitting explicit semantic events for the UI (`InventoryItemRemoved`, `EntitySpawned`). The UI should never hold the burden of guessing graph state transitions.

By strictly enforcing this API firewall, we get the absolute thread safety and high-performance of pure Event Sourcing (Architecture A), while avoiding the spaghetti-code orchestration that destroyed the previous iteration.

### The On-Demand Upstream Query (Pattern Deviation)
While we accept that the client maintains "Fat Entities" for standard UI layout and interactions, we do not require the client to blindly hoard massive obscure properties for fringe use cases. 

For heavy, specialized, user-initiated actions (like a TUI user specifically hitting `<F3> Inspect` to view an entity's 200 raw backend floats/bitfields), we explicitly endorse an upstream query pattern:
1. The UI fires an async `ClientCommand::QueryEntityDebugInfo(Guid)` up to the core engine.
2. The core locklessly processes the query and responds down the channel with a dedicated, heavy `ClientViewEvent::EntityDebugInfoSnapshot { data }`.

This allows the UI to trim the fattest edge cases from its continuous event stream cache, only pulling the massive relational trees when a user explicitly initiates an inspection workflow.
