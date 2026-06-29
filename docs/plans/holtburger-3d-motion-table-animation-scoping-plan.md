# Holtburger 3D Motion Table Animation Scoping Plan

## Context

Runtime spawn animation selection started as a request to auto-populate "default animation" for
WCID-backed browser spawns. The investigation showed that AC has several animation evidence layers:
setup `DefaultAnimation`, setup `DefaultMotionTable`, weenie `MotionTable`, live/server motion
state, and direct explicit animation ids. Motion tables are not simple mappings from state to one
animation id; they encode default style, style defaults, cycles, links, modifiers, motion data,
animation segments, velocity, and omega.

The current dynamic animation player can sample one concrete `animation/0300....` payload and submit
part transforms. It is suitable for explicit clips and simple setup default animation, but it is not
a full motion table interpreter or motion-state sequencer.

## Goal

Define the requirements and ownership boundaries for robust motion-table-driven visual animation in
the 3D presentation runtime without moving renderer policy into authoritative world state.

## Scope

In scope:

- Motion-table asset exposure and decoding needed by browser/runtime presentation.
- Resolving default/rest visual state from motion tables.
- Choosing visual cycles or links from host-projected motion state.
- Sequencing one or more animation segments from motion table entries.
- Preserving animation provenance in diagnostics.
- Browser inspection/debug UX for motion tables, cycles, links, and selected animations.
- Clear separation between authoritative motion state and visual playback.

Out of scope:

- Implementing the whole system in the current dynamic entity phase.
- Authoritative movement prediction or reconciliation.
- Gameplay ownership of inventory, equipment, combat, or death state.
- Treating Svelte/browser form state as the owner of prepared animation assets.
- Silent fallback from unsupported motion-table structures to a guessed first animation id.

## Ground Truth

- `ACE/Source/ACE.Server/Physics/Animation/MotionTable.cs`
- `ACE/Source/ACE.DatLoader/FileTypes/MotionTable.cs`
- `ACE/Source/ACE.Server/Physics/Managers/MotionTableManager.cs`
- `ACE/Source/ACE.Server/Physics/PartArray.cs`
- `ACE/Source/ACE.Server/Physics/PhysicsObj.cs`
- `ACE/Source/ACE.Server/WorldObjects/WorldObject.cs`
- `crates/holtburger-dat/src/file_type/motion_table.rs`
- `crates/holtburger-dat/src/file_type/setup_model.rs`
- `apps/holtburger-3d/src/lib/dynamic/dynamic-animation-player.ts`
- `apps/holtburger-3d/src/lib/dynamic/dynamic-entity-resource-manager.ts`
- `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`

## Current Evidence

- ACE `MotionTable.SetDefaultState` resolves rest/default state from `DefaultStyle`,
  `StyleDefaults[DefaultStyle]`, and `Cycles[(DefaultStyle << 16) | defaultSubstate]`.
- ACE setup defaults can apply setup `DefaultMotionTable`, then world object initialization applies
  the weenie `MotionTableId`, making weenie motion table evidence more specific than setup defaults.
- ACE `PartArray.InitDefaults` appends setup `DefaultAnimation` directly when present.
- Holtburger's DAT motion table parser already exposes `default_style`, `style_defaults`, `cycles`,
  `modifiers`, `links`, and `MotionData.anims`, but app-facing asset/DTO surfaces do not expose a
  motion-table route for frontend presentation resolution.
- The current frontend animation player plays a resolved animation payload. It does not choose
  cycles, links, transitions, stance changes, or multi-segment motion entries.

## Ownership Model

Authoritative host/world ownership:

- Server-provided current motion state, stance, motion command, movement flags, and lifecycle.
- Entity creation, replacement, removal, equipment, inventory, combat, and death semantics.
- Any future prediction/reconciliation input.

Frontend presentation/runtime ownership:

- Loading setup, animation, and motion-table presentation assets.
- Resolving visual animation selections from host-projected facts.
- Playing visual animation clips/sequences.
- Sampling object/root and part transforms.
- Applying visual-only hooks and effects.
- Renderer-facing bounds and browser selection diagnostics.
- Browser debug UX for manual animation and motion-table inspection.

Shared DAT/content ownership:

- Lossless motion-table parsing.
- Typed motion data structures and host asset serialization.
- No browser-specific UX policy.

## Required Concepts

- `MotionTableAsset`: app-facing DTO for `defaultStyle`, `styleDefaults`, `cycles`, `links`,
  `modifiers`, and the contained `AnimData` segments.
- `MotionAnimationSegment`: animation id, low frame, high frame, frame duration policy, speed
  modifiers, and source motion data provenance.
- `ResolvedMotionSelection`: a provenance-bearing visual choice such as setup default animation,
  motion-table default cycle, motion-table link, explicit animation, or none.
- `AnimationSequencePlayback`: runtime playback state for one or more animation segments, separate
  from the lower-level frame sampler.
- `PresentationMotionState`: frontend visual input projected from host/world motion state. It should
  reference current style, substate/command, requested command, and transition context without
  claiming gameplay authority.

## Browser UX Requirements

- Browser spawn form should keep explicit animation and none as simple controls.
- WCID application may prefill motion-table evidence, but it should not require users to understand
  motion tables for normal default/rest spawning.
- A separate debug/inspection panel can load a motion table by id and display:
  default style, style defaults, cycles grouped by style, links grouped by source/target, modifiers,
  and contained animation segments.
- Applying a motion table entry should be explicit about whether the user selected a cycle/link or a
  raw animation segment. These are not equivalent.
- Unsupported multi-segment or transition cases must display a clear unsupported reason rather than
  silently degrading to the first animation.

## Phased Scoping

### Phase 1: Motion Table DTO And Asset Exposure

Deliverables:

- Add or expose a `motion-table/0900....` host asset route if no existing route provides enough data.
- Serialize `MotionTable` into a typed DTO that preserves default style, style defaults, cycles,
  links, modifiers, and `AnimData` segments.
- Add frontend zod validation and prepared asset parsing for the DTO.

Acceptance criteria:

- A motion table id can be loaded through the asset service.
- DTO tests prove default style/default substate/cycle anim data survive serialization.
- Missing/malformed motion tables fail loudly with asset diagnostics.

### Phase 2: Default State Resolver

Deliverables:

- Implement a presentation resolver equivalent to ACE `SetDefaultState`: default style, style
  default substate, matching cycle.
- Return a provenance-bearing default selection rather than a bare animation id.
- Define behavior for default cycles with zero, one, or multiple animation segments.

Acceptance criteria:

- Single-segment default cycles resolve to playable animation sequence input.
- Missing default style, missing style default, and missing cycle each produce distinct diagnostics.
- Multi-segment defaults are either explicitly sequenced or explicitly unsupported with diagnostics.

### Phase 3: Sequence Playback Model

Deliverables:

- Add a playback layer above `DynamicAnimationPlayer` that can play one or more `AnimData` segments.
- Preserve per-segment frame ranges instead of assuming whole-animation looping.
- Keep the current single-animation path as the simplest sequence case.

Acceptance criteria:

- Existing explicit animation playback still works.
- A sequence with one segment matches current playback output.
- A sequence with multiple segments advances deterministically and records active segment
  diagnostics.

### Phase 4: Host Motion Projection Boundary

Deliverables:

- Define the visual projection from host/world motion facts into frontend presentation state.
- Keep host authority separate from renderer playback.
- Document how current style, current substate/command, requested command, speed, and transition
  context enter the presentation layer.

Acceptance criteria:

- Host/runtime code can provide motion facts without handing gameplay ownership to the renderer.
- Frontend presentation can choose cycle/link candidates from projected facts.
- Browser-authored spawn debug input can mimic projected motion facts for testing.

### Phase 5: Browser Motion Table Inspection UX

Deliverables:

- Add a debug/inspection UX to load a motion table id.
- Present default style/substate, cycles, links, modifiers, and animation segments.
- Let users apply a cycle/link/segment to a selected runtime spawn as a debug visual override.

Acceptance criteria:

- Loading a motion table by id shows structured entries.
- Applying a cycle/link/segment records provenance in selected dynamic diagnostics.
- Unsupported entries are selectable only as diagnostics, not as fake playable animations.

### Phase 6: Resteer And Cleanup

Deliverables:

- Reassess whether motion-table interpretation should remain app-local or whether any presentation
  primitives have proven reusable across non-browser 3D client surfaces.
- Remove transitional `setup-default` placeholders that this plan obsoletes.
- Update the dynamic entity implementation plan with follow-up phases or completion notes.

Acceptance criteria:

- Ownership boundaries are still clean.
- No renderer path owns authoritative gameplay state.
- No diagnostics collapse motion-table selections into bare animation ids without provenance.

## Risks And Mitigations

- Risk: motion tables are treated as simple animation lists.
  Mitigation: expose cycles, links, modifiers, and segments as different concepts in DTOs and UX.
- Risk: animation selection logic leaks into Svelte form code.
  Mitigation: keep resolution in app-local runtime/presentation modules; the form supplies intent.
- Risk: authoritative motion semantics move into renderer state.
  Mitigation: accept only host-projected presentation facts in the frontend animation controller.
- Risk: multi-segment motion entries are silently truncated.
  Mitigation: require explicit sequence support or explicit unsupported diagnostics.
- Risk: setup default animation work gets blocked behind the full motion system.
  Mitigation: keep setup `DefaultAnimation` autopopulation in the dynamic entity implementation plan
  as a separate narrow phase.

## Definition Of Done

- Motion table assets can be loaded and inspected without manual DAT tooling.
- Default/rest motion-table state can be resolved with ACE-equivalent evidence.
- Animation playback can represent motion-table segment provenance.
- Browser diagnostics show why an animation is playing, not just which animation id is playing.
- Host motion facts remain authoritative input, while frontend playback remains visual
  presentation.

## Open Questions

- Which real WCIDs should be used as representative fixtures for simple single-segment defaults,
  multi-segment defaults, and transition links?
- Should sequencing support land before browser inspection UX, or should inspection UX expose the
  unsupported cases first to guide sequencing work?
- Which animation hooks beyond `SetOmega` are required for the first believable creature/player
  motion-table playback slice?
