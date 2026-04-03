# Reference Data And Asset Delivery

## Purpose

This document captures the current architectural thinking around three related but different concerns:

1. Semantic client view state projected from authoritative world and core logic.
2. Static reference data that frontends may need to query directly.
3. Future on-demand asset delivery for a conventional 3D client.

This is intentionally **not** a concrete implementation plan. It is a design sketch and context document meant to preserve the reasoning behind recent changes and open questions so the project can resume this thread later without reconstructing the whole discussion from scratch.

## Why This Document Exists

The recent TUI bootstrap work exposed an architectural ambiguity around the spell table:

- XP and skill tables are clearly internal gameplay inputs. `holtburger-world` and `holtburger-core` consume them and project their effects as semantic player data.
- The spell table is currently transformed into `SpellCatalog` and then surfaced to the TUI as a directly consumed reference dataset.

That makes the spell table feel different from XP and skill tables, but it is still ultimately static client data loaded from mounted portal resources. This raises a question:

Should spell metadata continue to travel through `ClientViewEvent` as though it were view state, or is it really an early example of a broader reference-data or asset-delivery problem that the future 3D client will need to solve more generally?

This document argues that those concerns should stay distinct.

## Current State

### Runtime Architecture Today

At a high level:

- `holtburger-world` owns authoritative gameplay state and world-derived semantics.
- `holtburger-core` orchestrates session, world mutation, and frontend-safe projections.
- `holtburger-cli` consumes `ClientViewEvent`s and maintains local projection state for rendering.

The current frontend-facing model is intentionally push-oriented:

- frontend sends `ClientCommand`
- core handles command and/or server input
- world mutates authoritative state
- core projects semantic `ClientViewEvent`s
- frontend updates local render state

That pattern is healthy for gameplay state and shared semantics.

### How XP And Skill Data Reach The TUI Today

The TUI does **not** receive raw XP or skill tables.

Instead:

- `holtburger-world` uses `XpTable` and `SkillTable` to derive things like:
  - next rank XP
  - trained and specialized costs
  - level info
  - player-facing derived skill state
- `holtburger-core` projects those derived results into frontend-facing events such as:
  - `PlayerStatsSkillsUpdated`
  - `PlayerLevelInfoUpdated`
  - `PlayerVitalsUpdated`

This is the right shape. The TUI wants the semantics, not the raw backing tables.

### How Spell Data Reach The TUI Today

Spell data are different today.

- `holtburger-content` loads `SpellTable` from mounted portal data.
- `holtburger-content` exposes that data as `SpellCatalog` for frontend lookup.
- `holtburger-cli` stores that catalog in local UI state during bootstrap and uses it directly for:
  - context panels
  - spell detail rendering
  - spell and enchantment debug output
  - other direct spell lookups where raw spell metadata is useful

`ClientCommand::RequestInitialViewState` now stays focused on semantic runtime bootstrap such as fellowship and runtime-body snapshots.

That resolved the immediate layering problem, but it did **not** answer the larger question of whether spell metadata really belongs in the same category as semantic view snapshots.

## Architectural Distinction

The important distinction is not "table" versus "not table". The important distinction is **what kind of contract the frontend actually needs**.

There are at least three categories here.

### 1. Semantic View State

This is the state that frontends should receive as authoritative, already-interpreted gameplay information.

Examples:

- player stats and skills
- level info
- vitals
- active spells on the player
- world name
- entity spawn, movement, and despawn events
- combat mode
- confirmation state
- vendor and trade state

This category fits the current `ClientViewEvent` model extremely well.

Properties of this category:

- derived from authoritative world/core state
- changes over time during runtime
- should be projected in a frontend-safe, semantics-first form
- should not force frontends to re-derive gameplay logic from low-level data

### 2. Static Reference Data

This is data that may be useful to frontends directly, but is still fundamentally static client content rather than live gameplay state.

Examples:

- spell definitions
- spell descriptions
- spell set relationships
- possibly some weenie or item template metadata in future
- possibly icon/lookup metadata for UI inspection panels

This category is where the spell catalog most naturally fits.

Properties of this category:

- loaded from mounted client resources
- mostly immutable during a session
- often useful for direct lookup rather than continuous push
- semantically richer than raw DAT bytes, but still not gameplay state

### 3. Heavy Asset Delivery

This is the category a future conventional 3D client will need to care about in a serious way.

Examples:

- models
- textures
- animations
- terrain or geometry payloads
- environment and appearance data that may need demand loading, caching, or streaming

Properties of this category:

- potentially large
- likely demand-driven rather than broadcast-driven
- may require caching, eviction, prioritization, and progressive loading
- should not be modeled as `ClientViewEvent` snapshots

## Core Claim

`RequestInitialViewState` is a good fit for category 1.

It is an acceptable short-term fit for category 2 when the TUI just needs one bootstrap snapshot and nothing more sophisticated exists yet.

It is **not** the right long-term foundation for category 3.

That means the recent spell-catalog bootstrap work should be treated as a tactical convenience, not as the seed of the future asset-delivery architecture.

## Why Spell Catalog Feels Ambiguous

Spell metadata lives in an awkward middle ground.

It is not gameplay state in the same sense as a player's current vitals or skills.

But it is also not a "heavy asset" in the sense that a 3D client would stream models or terrain.

That leaves it with two plausible homes:

1. Keep treating it as a pushed snapshot because the current TUI just needs one up-front copy.
2. Reframe it as reference data and eventually serve it through a dedicated query or reference-data interface.

The second option better preserves future architectural flexibility.

## Why Raw XP And Skill Tables Should Stay Internal

Even if spell metadata eventually moves out of `ClientViewEvent`, XP and skill tables should probably not follow it.

Those tables are internal inputs to authoritative gameplay interpretation.

The TUI does not want:

- raw XP lists
- raw skill table rows
- raw derivation parameters

The TUI wants:

- the player's current skills
- their trained/specialized costs
- the next-rank XP numbers
- current level information

Those are already semantic world/core outputs. Exposing the raw tables would make the frontend shoulder responsibilities that belong in shared gameplay logic.

## Why Spell Metadata May Eventually Want A Different Interface

The spell catalog is used more like a lookup service than like changing world state.

Typical usage patterns look like:

- given a spell ID, resolve its display name
- given a spell ID, fetch human-readable details
- given an enchantment, inspect related spell metadata

Those are query-like interactions.

That suggests a better long-term fit may be something conceptually like:

- a reference-data provider
- a client-side query surface
- or a static-content facade owned by core or another shared layer

The important part is not the exact API shape. The important part is recognizing that this is a different category of problem from event projection.

## Current Tactical Decision

For the TUI today, spell reference data should come from `holtburger-content`, while `ClientCommand::RequestInitialViewState` stays focused on semantic runtime bootstrap.

Reasons:

- it keeps spell metadata in the static-reference-data category instead of pretending it is live view state
- it keeps the bootstrap command-driven for actual runtime state such as fellowship and runtime-body snapshots
- it gives the TUI direct spell lookup data without making it parse DAT/HBA files itself
- it matches the future direction better than a pushed `SpellCatalogLoaded` event

This should still be treated as a narrow spell-reference-data seam, not as a statement that all static client data should eventually move through `holtburger-content` in the same way.

## Long-Term Direction

The long-term direction should likely separate the three categories more clearly.

### View-State Channel

Keep `ClientCommand` and `ClientViewEvent` focused on semantic, runtime-relevant state and actions.

This is the right home for:

- current gameplay state
- semantic world deltas
- frontend-consumable snapshots of authoritative state
- user interaction and control flows

### Reference-Data Channel

Introduce a distinct conceptual seam for static reference data that frontends may query directly.

This could eventually cover:

- spell definitions
- spell descriptions
- future inspect-oriented metadata
- possibly other static data that is useful at UI time but not part of live world authority

This should not require the frontend to parse DAT/HBA files itself.

It should also not require core to pretend every lookupable dataset is a view-state broadcast.

### Asset-Delivery Channel

When a future 3D client arrives, heavier asset delivery likely needs its own system with its own vocabulary.

That system may need ideas like:

- keyed asset requests
- async fulfillment
- cache ownership
- mounted dataset awareness
- quality tiers or fallback
- demand-driven loading rather than whole-dataset pushes

That system should be designed on its own terms instead of growing accidentally out of `SpellCatalogLoaded`.

## Design Pressure To Watch

### Pressure From The TUI

The TUI is low-fidelity and naturally pushes toward convenience APIs. That is fine so long as those APIs do not harden the wrong shape into shared crates.

The project architecture explicitly warns against letting the TUI define the shared client architecture for a future 3D client.

This is a textbook example of that pressure.

### Pressure From Implementation Convenience

Broadcasting one `SpellCatalogLoaded` event is easy. That convenience should not be confused with architectural correctness for broader reference-data or asset delivery.

### Pressure From Premature Generalization

At the same time, it would be over-engineering to build a full reference-data query layer or asset pipeline immediately just because spell metadata hints at one.

The correct stance is:

- do not overfit the current TUI convenience hack into permanent architecture
- do not prematurely build the full 3D asset system before its requirements are better understood

## Working Mental Model For Now

Until a broader reference-data or asset-delivery seam exists, it is useful to think in these terms:

- XP and skill tables are authoritative internal inputs.
- Their frontend-visible effects should continue to be semantic projections.
- Spell catalog is currently a frontend-facing reference snapshot.
- That snapshot is tolerated for the TUI, but should not be mistaken for the final asset architecture.

## Open Questions

These questions remain unresolved and should be revisited later.

1. Should spell metadata continue to be broadcast as a whole snapshot, or should it move to a query-oriented interface?
2. Which other static client datasets, if any, belong in the same reference-data category as spell metadata?
3. Should reference-data access live in `holtburger-core`, or should another shared abstraction own it?
4. How should mounted dataset scope and resolver semantics surface into a future query or asset-delivery API?
5. How much of the future 3D client's content needs are likely to overlap with the TUI's inspect/debug/reference-data needs?
6. What is the right boundary between "frontend directly queries shared reference data" and "core projects another semantic event"?

## Non-Goals Of This Note

This document does **not** specify:

- a concrete implementation plan
- a crate-by-crate rollout sequence
- exact traits or type names that must be introduced
- a final 3D asset-streaming design
- a commitment to move spell metadata immediately out of `ClientViewEvent`

It is a framing document intended to preserve the distinction between semantic state projection and static content delivery.

## Current Recommendation

For now:

- keep `RequestInitialViewState` for semantic frontend bootstrap snapshots
- do not expose raw XP or skill tables to the frontend
- let frontends query spell metadata from `holtburger-content` instead of via `ClientViewEvent`
- avoid building new shared APIs that assume event-based reference-data delivery is the permanent model
- revisit spell metadata once the broader reference-data and future 3D client needs are clearer

That preserves momentum today without accidentally locking the project into the wrong abstraction tomorrow.