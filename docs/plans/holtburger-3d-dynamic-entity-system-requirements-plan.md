# Holtburger 3D Dynamic Entity System Requirements Plan

## Context

The canonical browser frontend now has a static rendering pipeline for terrain, static objects,
structured interiors, portal traversal, runtime-owned scene anchoring, shared asset preparation, and
explicit renderer updates. The next major architecture gap is dynamic entities.

This document is intentionally a requirements plan, not an implementation plan. It exists to collect
evidence, define system boundaries, and settle requirements before writing implementation phases.

Dynamic entities must not inherit static landblock bake assumptions. Static-authored dynamic seeds
are one important entry point, but the durable system must also fit future world/session entities:
players, creatures, equipment, projectiles, animations, motion, parent/child attachments, and
authoritative entity updates from the client runtime.

## Goal

Define the requirements for a dynamic entity system that can hydrate, update, render, animate, select,
inspect, and evict dynamic instances without treating them as baked static draw units.

## Explicit Non-Goal

No implementation phases should be added to this document until the requirements gate is satisfied.
Implementation phases belong in this document only after the open requirements are resolved enough to
make the first vertical slice evidence-backed and testable.

## Ground Truth

Primary project references:

- `docs/plans/holtburger-3d-frontend-v2-design.md`
- `docs/plans/holtburger-3d-frontend-v2-implementation-plan.md`
- `ACE/` for authoritative server/world semantics.
- `ACViewer/` for DAT/rendering and setup/animation interpretation.
- `acclient-eor-source/` as secondary evidence only.

Current frontend constraints to preserve:

- Runtime owns orchestration, scene anchoring, and renderer-local placement.
- Asset service owns typed asset identity, preparation semantics, cache, in-flight dedupe, leases,
  warm retention, and failure semantics.
- Renderer consumes explicit static layer commits, dynamic resource/instance commits, texture/
  resource updates, and frame state. It does not fetch assets, walk dependencies, classify AC source
  data, or own semantic entity identity.
- Dynamic renderer submissions should consume the shared visual-resource/cache primitives from
  `docs/plans/holtburger-3d-shared-render-instance-static-instancing-plan.md` rather than creating a
  dynamic-only VAO, texture, material, or draw-submission stack. Dynamic entities still need their
  own renderer-facing instance commit shape because static render instances are outdoor-detail/static
  source shaped.
- Host route strings are transport/provenance only. Dynamic records must use typed identities,
  runtime-assigned handles, or opaque cache keys derived from typed identities.
- Static-authored dynamic seeds may be discovered by static resolver/bake paths, but the dynamic
  service owns hydrated resources, animation state, instance updates, renderer updates, and eviction.

## Carried Context

The canonical design already records these dynamic facts:

- `ObjectDescriptionData` can carry model data, physics flags/state, movement bytes, autonomous
  movement, animation frame, world position, motion table id, sound table id, physics-effect table id,
  setup id, parent/children, object scale, friction, elasticity, translucency, velocity,
  acceleration, omega, default physics script, sequence numbers, and public weenie description.
- `ModelData` carries palette, sub-palettes, texture changes, and model/part changes.
- World `Entity` state carries position, velocity, acceleration, omega, gfx/icon ids, flags, physics
  state, parent, motion snapshot, health fraction, properties, equipment-related state, and
  combat/book/profile data.
- Dynamic rendering shares static rendering dependencies for setup model, gfx object, material
  recipe, surface texture, render surface, palette, sub-palette, and texture-change resolution.
- Dynamic rendering has separate requirements for motion tables, animation state, equipment
  composition, physics scripts/effects, sound table references, parent-child attachments,
  per-instance scale/translucency, and continuously updated position/velocity/motion state.
- Renderer input should receive dynamic instance state and resource refs, not baked static draw
  units.

## User Steering Notes

Recorded on 2026-06-24 before deeper ACE/ACViewer/retail investigation:

- The first consumer should be dynamic static entities: static-authored objects that need dynamic
  rendering because they animate or otherwise cannot honestly remain baked static draw units. Their
  lifetime should match the other static objects in the same residence/scope.
- The main eventual consumer will be spawned objects requested by the host/runtime or by browser/future
  client mode. Spawned objects need explicit destruction. Their residence should probably be provided
  by spawn parameters.
- Spawned object residence links should be weak references. They must not induce scene interest and
  must not keep landblock/env-cell layers alive.
- Spawned objects with no residence, or that lose residence, may need an explicit unrendered
  homeless state. They can be promoted back to rendered residency if/when they gain residence.
- Dynamic drawables should render with their residence: an env-cell-resident entity renders with
  that env cell, and an outdoor-resident entity renders with the outdoor scene/domain it belongs to.
- Dynamic entities need a dynamic-specific spatial index layer. Cell-resident entities can stay flat
  by env-cell membership for the first slice. Outdoor-resident entities should use the existing
  landblock grid traversal as the outer broad phase plus a per-landblock mutable AABB index for
  current-frame dynamic entity bounds.
- Dynamic spatial query support is required for gameplay actions, selection, inspection, diagnostics,
  and debug tools. Pickability is caller policy over query results, not a core lifecycle property.
- Asset "scripts" are currently unclear. They may be attached to setup/appearance assets and may
  affect whether a source is dynamic. This needs evidence before it shapes implementation.
- Animation mechanics are currently unclear for both characters and static scenery animations. This
  needs evidence before implementation phases are written.
- Dynamic rendering should use the shared visual-resource/cache path introduced for generated outdoor
  static instancing. Actual WebGL2 instanced draws remain an optimization; the architectural
  requirement is shared resources plus per-instance submissions.
- Dynamic rendering can skip atlasing and VAO compaction initially.
- Dynamic entities need the same material support as static entities. The preferred direction is to
  make material/render pipelines part-agnostic where possible, so the reusable core is not split
  unnecessarily by static versus dynamic ownership.

## Investigation Findings

Recorded on 2026-06-24 after checking project, ACE, and ACViewer references:

- Static-authored dynamic entities remain the correct first consumer. Setup assets already expose
  default animation, default script, default motion table, default script table, lights, selection
  sphere, and multi-part setup composition. The current static source path expands setup parts and
  default placements into baked static geometry, so animated setup-backed scenery is likely being
  flattened too early.
- Spawned/live entities already have a usable authority stream. `ObjectCreate` / `UpdateObject`
  spawn or fully refresh object state, and `holtburger-core` already projects entity spawned,
  replaced, moved, kinematics, motion, runtime-body, and despawn events.
- World state already distinguishes entity existence from world presence. Clearing world presence can
  null the entity landblock, remove it from spatial membership, and retire the runtime body while the
  entity record continues to exist. The frontend dynamic model should mirror that with an explicit
  unrendered/no-residence state.
- Dynamic entity transform records must be landblock-local, matching the static draw-unit pattern.
  Runtime/render orchestration should transform them into scene/render space as needed for the
  current anchor. Dynamic spatial indices should also index landblock-local bounds/poses so
  reanchoring can update scene placement without rewriting authoritative dynamic records.
- Dynamic records should preserve source residence separately from effective frontend presentation
  residence. Source residence comes from static seed facts, host/runtime spawn facts, or browser
  spawn parameters. Effective presentation residence is derived from current frontend pose/bounds and
  drives rendering, query, and spatial index membership.
- Dynamic drawables should render with their effective presentation residence. Env-cell residents
  submit in the accepted env-cell/interior context; outdoor residents submit in the outdoor scene
  context; no-effective-residence entities do not render.
- Dynamic spatial indexing must be separate from static BVH ownership. Env-cell membership can be a
  coarse interior key, but outdoor dynamic entities need a mutable dynamic-friendly broadphase rather
  than rebuilding or piggybacking on static landblock BVHs.
- Current browser picking is static-only and returns static selection keys. Dynamic support needs a
  merged scene-query surface with static and dynamic hit variants, where dynamic hits return stable
  semantic entity identity rather than renderer draw-unit identity. Browser/client mode can then
  filter those hits for selection, gameplay targeting, inspection, or debug use.
- Asset scripts are timed render/effect hook timelines, not passive setup metadata and not the
  exclusive home of animation data. Physics scripts can drive replacement parts, no-draw,
  transparency, diffuse/luminous color, scale, particles, sounds, omega, texture velocity, lights,
  default-script chaining, and default-script-part chaining.
- Animation data is separate but intersects script execution. Setup assets compose parts and can
  name default animation/script/motion/script-table assets; raw animation assets carry object frames,
  per-part frames, and hooks; motion tables map motion/style state to animation assets and frame
  ranges; physics scripts schedule hooks over time; PlayScript values are semantic cues that select
  scripts rather than script assets themselves.
- Effects are not a single standalone asset category. The shared animation-hook vocabulary defines
  timed commands and payloads; executing those hooks produces render/audio/effect state changes. Some
  hook payloads reference assets or tables such as particles, particle emitter systems, sounds,
  replacement visual data, lights, or scripts, while other hooks are direct state mutations.
- Physics scripts do not encode authored object pose or translation frames. A physics script record
  is a sorted list of `start_time` plus hook entries. Object position/part pose comes from animation
  position frames, per-part animation frames, movement/kinematics state, or object state updates.
  Physics-script effects can be spatially anchored, such as particle offsets, and can mutate
  transform-adjacent state such as scale or omega, but they are not the primary translation path.
- WebGL2 instanced draws exist for compatible static object render instances, but they are not a
  first-slice dynamic architecture dependency. Initial dynamic rendering should prefer correct shared
  resources plus per-instance submissions; batching can follow once the dynamic commit contract and
  residency behavior are proven.
- The material pipeline is more reusable than the static names imply. Structured interiors already
  reuse static object material classification, so dynamic rendering should generalize the material
  planner primitives instead of creating a second material interpretation path.

## Script And Animation Taxonomy

This section records the current evidence-backed model for AC setup animation and script assets. It
exists to keep the dynamic entity requirements from treating "animation" and "script" as one vague
bucket.

- Setup assets (`0x02`) assemble a multi-part model and default visual behavior. They define parts,
  parent relationships, placements, selection/collision spheres, lights, and default references such
  as default animation, default script, default motion table, default sound table, and default script
  table.
- Animation assets (`0x03`) contain raw animation data. They can include object-position frames,
  per-part frames, and animation hooks attached to frames.
- Motion table assets (`0x09`) map motion/state/style concepts to raw animation assets and frame
  ranges. Their animation entries include animation id, low frame, high frame, and frame rate.
- Physics script assets (`0x33`) are timed lists of animation hooks. They are effect timelines, not
  skeletal or per-part frame animation storage.
- Physics script table assets (`0x34`) map PlayScript semantic cues to one or more script choices,
  usually qualified by mod/intensity.
- PlayScript is a semantic cue enum, not a script asset. Examples include launch, explode, hide,
  unhide, and breathe-flame style events. A cue can resolve through a script table, while other
  network paths can directly queue a script asset by id.

Hook/effect semantics:

- The term "hook" names the shared command format. Animation frames and physics scripts both carry
  the same hook vocabulary.
- The term "effect" names the runtime consequence of executing a hook, not necessarily a separate
  asset. Examples include no-draw state, translucency transitions, part replacement, particle
  emitter creation, texture scrolling, sound playback, light toggles, scale changes, or angular
  velocity changes.
- Some hook effects are asset-backed or table-backed. `CreateParticle` references emitter info and a
  part-relative frame offset; `CallPES` references a particle emitter system; sound hooks reference
  sound ids or sound tables; replacement hooks carry replacement visual data; default-script hooks
  queue another script path.
- Other hook effects are direct object or part state mutations. `NoDraw`, `SetLight`,
  `TextureVelocity`, `TextureVelocityPart`, and `SetOmega` change current object state until another
  hook or authoritative update changes it.
- Some hooks carry explicit transition duration. `Transparent`, `TransparentPart`, `Luminous`,
  `LuminousPart`, `Diffuse`, `DiffusePart`, and `Scale` include start/end/time or end/time payloads,
  so their effect is time-varying after the hook fires.
- Physics scripts do not carry pose frames or authored translations. Their positional content is
  limited to hook-specific payloads, such as particle emitter offsets. If an object translates, that
  should come from animation position frames, per-part frames, movement/kinematics, or authoritative
  object position updates.

Host/frontend ownership model:

- Host/runtime and frontend runtime may both need to understand the same decoded animation,
  motion-table, physics-script, script-table, and hook payload data. They should not run independent
  incompatible systems; they should run different projections of the same authored timelines.
- Shared decoded timeline data should feed a host-authoritative evaluator and a frontend
  presentation evaluator. The split is by authority and effect policy, not by asset kind.
- Host/runtime owns authoritative entity existence, lifetime, residence, landblock-local pose inputs,
  movement interpretation, collision/physics-affecting state, combat-significant animation hooks,
  and live/semantic timeline trigger authority. "Timeline trigger authority" means deciding that a
  live entity starts, replaces, cancels, or retimes an authored animation/script/motion path with
  semantic consequences. It does not mean the host streams or owns the frontend's per-frame
  presentation animation clock.
- Static-authored setup default animations can start locally from static seed facts when retail
  evidence proves the default behavior and no host timeline trigger is required.
- Any hook whose outcome changes world semantics, collision, combat, targeting/action validity, or
  persisted entity state is host/runtime-owned unless proven presentation-only.
- Frontend runtime owns high-frequency animation pose playback for rendering, render/audio/effect
  hook playback, material transitions, particles, texture velocity, visual interpolation, spatial
  query records, and presentation-only local state derived from host-authorized timeline starts or
  retail-proven static setup defaults.
- Physics scripts are not wholly host-owned or wholly frontend-owned. A script trigger can be
  host-authoritative while the frontend locally plays the visual/audio timeline from a host timestamp
  or sequence id.
- The bridge should prefer authority facts and timeline trigger facts over per-frame animation data
  or per-hook presentation spam. Bridge messages should preserve entity id, timeline/script id or
  PlayScript cue, resolved script id when available, speed/intensity/mod, start timestamp, and
  sequence/cancel identity.
- Frontend hook execution must not create authoritative truth. If a frontend hook affects collision,
  combat timing, entity visibility semantics, targeting, or durable world state, that effect must be
  represented as host-owned state or explicitly classified as a visual-only approximation.
- Drift is a first-class risk. Host and frontend projections must agree on asset ids, timeline start
  times, speed/intensity, script-table resolution, cancellation/sequence rules, hook ordering, and
  hook ownership policy.

Proposed frontend runtime shape:

- Use a small hybrid dynamic runtime: an imperative coordinator with typed records and a few
  ECS-like record passes where that shape is useful. Do not introduce a full ECS framework, generic
  component registry, query DSL, archetype store, sparse-set component engine, or event bus for the
  first slice.
- Start with a typed `DynamicEntityStore` backed by `Map<DynamicEntityId, DynamicEntityRecord>`.
  Records may contain typed sub-objects for provenance, residence, base landblock-local transform,
  visual/setup resource state, animation playback state, render instance state, bounds state, and
  diagnostics.
- First-slice ECS-like data should live on `DynamicEntityRecord` as nested typed sub-records. Do not
  start with separate component arrays/maps for animation, resources, transforms, bounds, or
  renderability.
- Keep behavior in explicit dynamic entity modules coordinated by `DynamicEntityController.tick()` and
  static-scope reconciliation:
  - seed ingestion / host delta ingestion;
  - resource coordination;
  - animation playback;
  - hook interpretation;
  - dynamic transform integration;
  - placement/bounds/index synchronization;
  - renderer snapshot/commit;
  - diagnostics projection.
- Animation playback and dynamic transform integration are the first ECS-like passes over typed
  records. Resource coordination, hook interpretation, diagnostics projection, renderer commits, and
  tightly coupled placement/bounds/index synchronization should stay imperative/service-shaped until
  requirements prove a cleaner split.
- Add script playback, hook-effect routing, attachment handling, and component-index optimizations
  only when their requirements are proven by the worksheet or profiling.
- Split nested entity state into separate component maps/arrays only when there is real iteration
  pressure, such as many active animations, active script timelines, independent bounds updates,
  pending resource queues, or measured frontend performance pressure.
- Renderer objects are output/resource handles, not source-of-truth dynamic components. The dynamic
  runtime owns semantic state; the renderer consumes submission snapshots whose renderable parts
  reference shared visual resources where possible.

Known trigger channels:

- Setup defaults can start default animation/script behavior and provide default motion, sound, and
  script-table references during object/setup initialization.
- Object create/update payloads can carry motion table, animation frame, default script, and default
  script intensity data. Movement data and explicit animation-frame data are separate payload shapes.
- Network PlayEffect/GameMessageScript messages can target an object id with a PlayScript cue or a
  direct script id, depending on the retail path being mirrored.
- Animation frame hooks can trigger script-related behavior such as DefaultScript and
  DefaultScriptPart.
- State transitions and collision paths can trigger script-table lookups or default-script behavior;
  hide/unhide is the important render-state example.

Dynamic-system implications:

- The primary animation path is setup plus animation plus motion table.
- The primary script path is PlayScript/script-table/direct-script lookup plus timed hook execution.
- The first implementation slice must choose a supported hook subset instead of silently ignoring
  render-affecting hooks.
- Unsupported hooks should be surfaced through diagnostics with enough context to decide whether the
  target is still visually honest.
- No-draw, replacement parts, transparency, texture velocity, lights, particles, sounds,
  DefaultScript, and DefaultScriptPart are real script effects. Some can be deferred, but deferral is
  a conscious visual-fidelity tradeoff rather than proof that scripts are irrelevant.
- Hook ownership must be explicit. Initial policy categories are `host-authoritative`,
  `frontend-presentation`, `both-projected`, and `unsupported`.

## Discovery Worksheet

This worksheet owns the open requirements questions. The discovery tracks below capture direction and
evidence boundaries; avoid duplicating the full question inventory there.

### 1. First Target

Choose one concrete evidence-backed dynamic target. Trace every dependency needed to render,
animate, select, and validate it:

- setup, animation, motion table, script table, hooks, materials, residence, scene query, and validation
  assets.
- source authority: static-authored seed, live entity, browser/client-spawned entity, or host-spawned
  entity.
- whether synthetic browser-mode entities are allowed for renderer/resource validation, or whether
  every early target must come from real captured/server data.

Candidate static-authored animated targets:

- `outdoor-static-object:outdoor-detail:cf95ffff:landblock-static/cf95ffff/object/0000/020003e5`
  at observed distance `17.28`.
  - Setup `0x020003e5` has default animation `0x0300061b`, no default script, no default motion
    table, no default sound table, and no default script table.
  - Animation `0x0300061b` has 5 parts, 60 frames, no object position frames, and no hooks. This is
    a clean candidate for first-slice part-pose playback without script/effect ownership noise.
  - Setup parts are `0x010010cb`, `0x010010c7`, `0x010010cb`, `0x010010cb`, `0x010010cb`.
  - User retail-client visual check: this is windmill blades. The whole object appears to rotate
    continuously in place as soon as the scene loads.
  - Harness asset dump: animation `0x0300061b` has no position frames and no hooks, but its per-part
    frames animate both origin and orientation. Four blade parts sweep about `7.47` units from their
    frame-0 origin over the sampled cycle, while the hub part has fixed origin and changing
    orientation. This target requires live per-part origins and rotations, not just in-place
    orientation playback.
- `outdoor-static-object:outdoor-detail:d095ffff:landblock-static/d095ffff/generated/scene/1200008e/cell/01/template/0006/020005ac`
  at observed distance `8.10`.
  - Setup `0x020005ac` has default animation `0x03000751`, no default script, no default motion
    table, no default sound table, and no default script table.
  - Animation `0x03000751` has 2 parts, 7 frames, no object position frames, and one hook:
    `SetOmega` (`type=22`) on frame 0.
  - Setup parts are two instances of `0x010016e0`.
  - This is a better second target than first target because it exercises animation-hook ownership
    and transform-adjacent state without requiring physics scripts.
  - User retail-client visual check: this is a bird that flaps its wings and circles a spot
    continuously as soon as the scene loads. The motion likely combines part-frame wing flapping
    with `SetOmega` or another transform-side rotation around an offset origin.
  - Harness asset dump: animation `0x03000751` has no position frames, one frame-0 `SetOmega` hook
    decoded as vector `(0.0, 0.0, -0.038397)`, and two parts with fixed origin
    `(-0.000001, -12.0, 15.0)` but changing orientations. The likely circling model is object-frame
    omega rotating offset part placements while part-frame orientation animates wing flapping.

### 2. Timeline Lifecycle

Define how animation and script timelines start, stop, and interact:

- cancellation, replacement, looping, speed changes, script chaining, overlapping scripts,
  residence loss mid-timeline, and despawn mid-timeline.
- host/frontend timestamp, sequence, cancellation, and speed/intensity fields required to prevent
  timeline drift.

### 3. Hook Ownership Matrix

Classify each hook as `host-authoritative`, `frontend-presentation`, `both-projected`, or
`unsupported`.

- Treat `Attack`, `Ethereal`, `NoDraw`, `Scale`, `SetOmega`, `DefaultScript`, and
  `DefaultScriptPart` as suspicious until proven. `CreateBlockingParticle` is proven to be a
  presentation particle create-without-replace variant, but still needs particle-lifecycle support.
- Track dependency type, presentation behavior, authoritative behavior, bridge fields,
  unsupported/deferred behavior, and evidence links.
- The first implemented hook capability can be `SetOmega`, but the first hook architecture should not
  be a `SetOmega`-specific path. It should decode typed hook payloads, pass hook invocations from
  animation/script playback into a shared hook dispatcher/router, apply supported effects through typed
  handlers, and diagnose unsupported hooks with entity, timeline, frame, and hook context.

### 4. Equipment And Attachments

Distinguish visual composition from independent entity composition:

- part-local visuals under parent residence.
- independently resident child entities with their own identity, lifetime, authority, query metadata,
  destruction, or movement.
- equipped/wielded items, clothing/armor, projectiles, parent-child transforms, and attachment
  points.

### 5. Dynamic Bounds

Define bounds sources and update rules:

- setup geometry, animation pose, scale hooks, replacement parts, attachments, and part-anchored
  effects.
- whether effects contribute to render bounds, query bounds, gameplay bounds, diagnostics only, or
  no bounds.
- current-frame bounds are the first-slice baseline. Swept/cycle bounds are a future precision mode
  only if a later target or query policy proves they are necessary. Hook-driven object-frame motion
  such as `SetOmega` can move visible geometry far from the base entity origin even when the authored
  animation has no position frames.

### 6. Portal And Indoor Behavior

Define how resident dynamic entities interact with scene domains:

- env-cell submission, portal visibility, indoor/outdoor crossings, residence authority, and
  no-residence behavior.
- source residence versus effective frontend presentation residence.
- whether frontend movement across cells updates effective presentation residence while preserving
  the source/authoritative residence fact.
- whether movement across cells updates source residence or only host/runtime authority can do that.

### 7. Scene Query And Selection Semantics

Define dynamic spatial query as shared frontend infrastructure, not renderer-only inspection:

- merged static/dynamic hit ordering.
- semantic entity id plus optional part, attachment, or effect metadata.
- caller-provided filters for selection, gameplay targeting, inspection, debug overlays, and
  tool-specific queries.
- first-slice hit shape: selection spheres, conservative AABBs, per-part bounds, triangle hits, or a
  staged combination.

### 8. Resource Lifetime

Define dynamic resource ownership and reuse:

- prepared setup, animation, script, particle, sound, light, material, and texture dependencies.
- sharing, leasing, eviction, missing-dependency diagnostics, and resource readiness reporting.
- For the first slice, require only dependencies needed to render the selected target honestly:
  setup, part/gfx/material/texture resources, and animation frames. Unsupported dependency references
  should still be preserved and diagnosed; they should not be turned into a baked static fallback.
  Unsupported render-affecting hooks may be skipped for first-slice rendering as long as the runtime
  reports them through diagnostics and console warnings with enough context to inspect the visual
  compromise.
- Dynamic resource readiness should resolve setup/gfx/material/texture dependencies into the same
  shared visual resource keys used by generated static instances wherever the visual facts are
  isomorphic. Per-entity animation, transform, bounds, and residence remain dynamic instance state.

### 9. Bridge Contract

Define the host/frontend DTO inventory:

- entity spawn/update/despawn, residence, authoritative pose/state, motion state, timeline triggers,
  script-table resolution, sequence/cancel identity, resource readiness, diagnostics, and query
  payloads.
- timeline trigger facts and authoritative state deltas should cross the bridge; per-frame animation
  transforms and frontend-only per-hook presentation events should not.

### 10. Frontend Runtime Shape

Define the first-slice dynamic runtime without overfitting it:

- typed entity store shape and required sub-objects.
- module order for seed/host ingestion, resource coordination, animation playback, hook
  interpretation, placement/bounds/index synchronization, renderer snapshot/commit, scene query, and
  diagnostics projection.
- which future capabilities would justify component maps or indexes: active scripts, hook effects,
  attachments, spatial indexing, resource queues, or measured iteration pressure.

### 11. Reconciliation

Define frontend behavior when host corrections arrive:

- pose, motion state, active timelines, residence, no-draw, ethereal, scale, script cancellation, and
  script-table resolution.
- whether first-slice behavior snaps, restarts timelines, adjusts playback clocks, layers correction
  over presentation, or only reports diagnostics.

Reconciliation means resolving disagreement between frontend-local playback state and newer
host/runtime or static-scope truth. The frontend can advance animation and script timelines locally
for smooth presentation, but it must not treat that local playback as authoritative state.

### 12. Dynamic Spatial Index

Choose the first dynamic-friendly query strategy and ownership shape early:

- local-space storage, query API, effective-residence-keyed membership, no-effective-residence
  behavior, removal behavior, current-frame bounds, precision metadata, and interaction with static
  scene queries.
- Outdoor mutable entities and env-cell resident entities use different first-slice coarse keys while
  sharing the same local-space invariant. Outdoor entities are keyed by effective presentation
  landblock membership; env-cell entities can stay keyed by effective env-cell membership and use flat
  lists until a target proves more is needed.
- Outdoor dynamic query should use the existing landblock-grid candidate traversal as the outer broad
  phase, then query a per-landblock mutable AABB index for dynamic candidates.
- The per-landblock outdoor index should be R-tree/RBush-style: a mutable hierarchy of 2D AABBs
  keyed by current-frame landblock-local dynamic bounds, with full 3D bounds and semantic entity
  metadata retained on each item for narrow-phase checks.
- The API must handle transform hooks such as `SetOmega` producing large visible position deltas from
  an unchanged base entity origin by updating current-frame bounds in the owning landblock index.
- The API must also handle presentation motion crossing landblock or env-cell boundaries. Dynamic
  placement should resolve effective presentation residence from current pose/bounds and update index
  memberships so entities do not disappear from render/query when their source residence no longer
  matches their visible position.

### 13. Diagnostics

Expose enough state to prove the system:

- why an entity is or is not renderable.
- source residence, effective presentation residence, authoritative pose, active timelines,
  unsupported hooks, missing assets, bridge drift, dynamic/static classification evidence, and query
  identity.

### Required Artifacts Before First-Slice Implementation Phases

Before writing first-slice phased implementation steps, reduce the worksheet to these concrete
artifacts:

- Hook Ownership Matrix for the first target and immediate `SetOmega` follow-up.
- Static-authored portions of the Dynamic Entity Lifecycle Matrix.
- First-slice Bridge DTO Inventory for static seed facts and animation asset lookup.
- First-target dependency trace.
- First-slice dynamic spatial index/query choice.
- First-slice validation strategy.

### Proposed Hook Ownership Matrix

Status: proposed. Confidence: high for `SetOmega` and no-hook first target; medium for material,
audio, particle, and script-chaining hooks; low-medium for gameplay/collision-adjacent hooks until a
target requires them.

Ownership terms:

- `host-authoritative`: the host/runtime owns the semantic outcome. The frontend may display it but
  must not create truth.
- `frontend-presentation`: the frontend may apply the effect locally after an authorized timeline or
  static setup default starts.
- `both-projected`: the same decoded timeline event has host/runtime consequences and frontend
  presentation consequences.
- `unsupported`: do not apply silently; expose diagnostics and pick a target-specific policy before
  relying on it.

| Hook ids | Hook names | Initial ownership | Effect class | First-slice policy |
| --- | --- | --- | --- | --- |
| `0` | `NoOp` | frontend-presentation | no-op | Ignore explicitly. |
| `1`, `2`, `21` | `Sound`, `SoundTable`, `SoundTweaked` | frontend-presentation | audio asset/table effect | Defer for first target; preserve decoded hook summaries and route later through presentation audio. |
| `3` | `Attack` | host-authoritative | gameplay/combat event | Unsupported until live combat target; frontend may only display host-authorized presentation. |
| `4` | `AnimationDone` | both-projected | timeline lifecycle event | Defer queue semantics for first target; needed for chained/queued animation correctness. |
| `5` | `ReplaceObject` | frontend-presentation | visual geometry/resource replacement | Defer; bounds-affecting and must invalidate render resources/bounds when supported. |
| `6` | `Ethereal` | host-authoritative | collision/physics/interactability state | Frontend no-op for rendering unless host/runtime projects a visual, targetability, or query-filter consequence. |
| `7`, `20` | `TransparentPart`, `Transparent` | frontend-presentation | timed material state | Defer; should become material transition state. |
| `8`, `9` | `Luminous`, `LuminousPart` | frontend-presentation | timed material/light-like state | Defer; should become material/light transition state. |
| `10`, `11` | `Diffuse`, `DiffusePart` | frontend-presentation | timed material color state | Defer; should become material transition state. |
| `12` | `Scale` | both-projected | transform and bounds state | Defer for first target; bounds-affecting and likely host-owned if collision scale matters. |
| `13`, `19` | `CreateParticle`, `CallPES` | frontend-presentation | asset-backed particle/effect spawn | Defer; particles inherit entity residence and are not semantic entities by default. `CreateParticle` replaces an existing emitter with the same id. |
| `14`, `15` | `DestroyParticle`, `StopParticle` | frontend-presentation | particle/effect lifecycle | Defer with particle support. |
| `16` | `NoDraw` | both-projected | semantic visibility plus render state | Unsupported until target policy; frontend may hide visuals only when host/static truth authorizes it. |
| `17`, `18` | `DefaultScript`, `DefaultScriptPart` | both-projected | script chaining | Unsupported until script timeline lifecycle is implemented; preserve summaries and diagnose. |
| `22` | `SetOmega` | both-projected | dynamic transform component | Second-target hook. Decode to omega/angular velocity, update dynamic transform state, and update current-frame bounds. |
| `23`, `24` | `TextureVelocity`, `TextureVelocityPart` | frontend-presentation | material UV animation | Defer; presentation-only unless later evidence says otherwise. |
| `25` | `SetLight` | frontend-presentation | light/render state | Defer; presentation light state unless host semantics are found. |
| `26` | `CreateBlockingParticle` | frontend-presentation | asset-backed particle/effect spawn with no-replace semantics | Defer with particle support. Retail blocks creation only when the requested emitter id already exists; it does not create collision/blocking physics. |

First-target implication:

- `0x020003e5` has no hooks, so the first slice can validate dynamic playback without executing a
  hook effect. The runtime should still introduce the hook invocation/router shape early so adding
  `SetOmega` is an incremental handler addition rather than a second architecture.
- `0x020005ac` requires `SetOmega` for visual parity. It is the first targeted hook execution
  candidate and should validate transform integration, bounds updates, and diagnostics.
- `CreateBlockingParticle` no longer needs to be treated as collision-suspicious. ACE models it as a
  `CreateParticleHook` subclass with the same payload, and retail `CreateBlockingParticleEmitter`
  only prevents replacing an existing emitter id before falling through to normal particle creation.

### Proposed Dynamic Entity Lifecycle Matrix

Status: proposed. Confidence: high for static-authored first slice; medium for host-spawned and
browser/client-spawned entities; low-medium for complex equipment until live examples are captured.

The frontend runtime normalizes dynamic entity records after a spawn/source fact exists. It should not
own gameplay or tool intent to spawn entities. Host/runtime and browser/future client mode are spawn
authorities; the frontend runtime should see explicit lifecycle inputs with source metadata and then
apply the same storage, resource, source/effective residence, bounds, and renderer-submission
machinery.

Residence terms:

- `sourceResidence`: the static seed, host/runtime, or browser/client source fact. It is retained for
  diagnostics, reconciliation, and source/authority provenance.
- `effectiveResidence`: the frontend presentation residence derived from current pose and bounds. It
  drives renderer submission, spatial index membership, and scene-query participation.
- Effective residence can differ from source residence when frontend presentation motion crosses
  landblock or env-cell boundaries. This is expected for future velocity/motion paths such as
  projectiles, creatures, players, and other moving entities. It does not feed back to the host.

Lifecycle by source:

| Source kind | Creation authority | Source residence rule | Render/resource lifetime | Query/filter metadata | Destruction rule |
| --- | --- | --- | --- | --- | --- |
| Static-authored dynamic seed | Static scope resolver discovers authored dynamic evidence such as setup default animation. | Inherits owning static scope residence. | Dynamic runtime owns resource readiness and renderer submissions; lifetime follows owning static scope. | Indexed when effective residence is renderable. Metadata should distinguish scenery/default-selection-excluded targets from debug-inspectable targets. | Static scope eviction, source removal, or failed replacement removes dynamic record/submissions. |
| Host-spawned live entity | Host/runtime object create/update stream. | Explicit host/runtime residence; scene links are weak and must not create interest. | Dynamic runtime hydrates resources while entity exists; renderer submits only when effective residence is renderable. | Indexed when effective residence is renderable with semantic entity id and host/source metadata. Browser/client filters decide selection/targeting use. | Host despawn/destroy removes entity; no-residence alone does not destroy it. |
| Browser/client-spawned entity | Browser mode, future client mode, or local tool/effect/debug controller. | Explicit client-provided residence or no-residence; never induces scene interest. | Explicit lifecycle from owning controller; may include TTL, cancel token, or explicit destroy. | Indexed when effective residence is renderable with owner/tool metadata. Caller filters decide whether it participates in selection, tools, debug, or gameplay-local queries. | Owning browser/client controller sends explicit destroy/cancel/expiry. |
| No-residence live entity | Existing entity loses or lacks renderable source residence. | Stored with no source residence until source/authority provides one. | May retain semantic state and warm resource intent, but submits nothing unless frontend placement can resolve a renderable effective residence. | Not indexed into scene queries while it has no effective residence. | Promoted when source/effective residence returns; destroyed only by authority. |
| Selectable equipment/child entity | Host-owned object with GUID/parent/wielder relation. | Independent entity identity; source residence derives from parent/host relation. | Child entity owns visual resource state; attachment relation supplies transform composition and effective residence. | Indexed independently when effective residence is renderable. Browser/client selection filters can include weapon/shield-like equipment. | Host parent change, detach, container change, or despawn updates/removes relation/entity. |
| Body-part replacement equipment | Host/object description or appearance composition, not independent selectable entity. | Inherits owning avatar/entity source/effective residence. | Appearance resource composition under parent entity. | Indexed as parent appearance geometry or part metadata, not independent semantic entity by default. | Parent appearance/equipment update removes or replaces it. |
| Part-anchored presentation effect | Animation/physics-script hook creates visual effect. | Inherits owning entity source/effective residence unless promoted to an independent entity by evidence. | Effect runtime owns local lifetime; may affect render/debug bounds. | Indexed only if it has meaningful spatial bounds for debug/effect queries; excluded from gameplay selection filters by default. | Timeline hook, duration, stop/destroy hook, residence loss policy, or parent despawn. |

Runtime lifecycle states:

| State | Entry | Renderer submission | Spatial/query behavior | Exit |
| --- | --- | --- | --- | --- |
| `discovered` | Static seed, host spawn fact, or browser/client spawn fact arrives. | None. | None. | Move to `resource-pending` after identity/source-residence facts are recorded. |
| `resource-pending` | Required setup/animation/material resources are requested. | None. | Diagnostics only. | Move to `resident-active`, `no-residence`, or `failed`. |
| `resident-active` | Required resources are ready and effective residence is renderable. | Submit current dynamic instance/resource commit. | Index current-frame landblock-local bounds according to target policy and effective memberships. | Resource failure, effective residence loss, scope eviction, host correction, or destruction. |
| `no-residence` | Entity exists but has no renderable effective residence. | None. | Excluded from scene query/culling indices; may stay in semantic store. | Effective residence returns, entity destroyed, or local owner cancels. |
| `failed` | Required resource or decode failure prevents honest rendering. | None. | Diagnostics only. | Source facts change, retry policy, scope eviction, or entity destruction. |
| `destroyed` | Static scope eviction, host despawn, frontend cancel, or owning parent removal. | Remove submissions/resources/indices. | Remove query records. | Terminal for that entity id unless a new authority event creates a new record. |

## Proposed First-Slice Answers

These are proposed answers for the first implementation target. They are intentionally narrower than
the full dynamic entity system.

### Target

Status: Proposed. Confidence: High.

- Use `0x020003e5` as the first target.
- It is a static-authored outdoor setup with default animation `0x0300061b`, 5 parts, 60 frames, no
  object position frames, no hooks, no default script, no default motion table, and no default script
  table.
- Treat `0x020005ac` as the second target because it adds a `SetOmega` animation hook and visible
  circular/wing-flap motion without adding physics scripts.

### Seed Classification

Status: Proposed. Confidence: High for first slice.

- A static source whose `SetupModel.default_animation` is present should become a static-authored
  dynamic seed instead of baked static geometry.
- First-slice seed classification does not require default scripts, script tables, motion tables, or
  PlayScript evidence.
- Seed provenance must preserve the original static source key, setup id, owning static scope, and
  source residence so diagnostics can explain why the source became dynamic.

### Entity Store And Lifetime

Status: Proposed. Confidence: High for first slice.

- Store the seed in the frontend dynamic runtime as a typed `DynamicEntityRecord`.
- The entity stores source residence and effective presentation residence. Parts and animation-local
  transforms inherit the entity's effective presentation residence for render/query/index purposes.
- Static-authored first-target entities usually have matching source and effective residence, but the
  first-slice runtime should still compute and track effective residence so `SetOmega`, future
  velocity/motion, and later live entities do not disappear from query/index membership when their
  visible bounds cross a landblock or env-cell boundary.
- Static-authored seed lifetime follows the owning static scope. If the scope evicts or the source
  disappears, the dynamic entity and renderer submissions are removed.
- The entity base transform remains landblock-local; scene/render-local transforms are derived at
  submission time.

### Resource Readiness

Status: Proposed. Confidence: Medium-high.

- Reuse existing setup, gfx, material, texture, and prepared static resource paths where the facts are
  isomorphic.
- Add animation readiness to the dynamic resource state. The first target needs setup, part geometry,
  material resources, and animation frames before it can render honestly.
- The current host/frontend asset contract exposes `SetupModel.defaultAnimation`, but it does not
  expose animation assets as independent payloads. Dynamic playback needs a first-class animation
  lookup/payload instead of embedding frame data into setup payloads.
- Scripts, particles, sounds, lights, and script tables remain deferred unless a selected target
  depends on them.
- Resource planning should preserve and diagnose unsupported dependency references without preparing
  them for execution. Unsupported render-affecting hooks warn and render as if the hook did not exist
  for the first slice. Missing required asset dependencies still make the entity currently
  non-renderable.
- Missing required dependencies make the entity currently non-renderable with loud console
  diagnostics rather than silently falling back to baked static rendering. This is transient runtime
  state, not a durable failure tombstone.

### Animation Runtime

Status: Proposed. Confidence: High for first target.

- Frontend runtime owns playback of the default animation for presentation.
- First-slice playback can loop the default animation locally from frame 0 using frontend time.
  Retail default setup animation startup uses frame rate `30.0` when the setup supplies a default
  animation and no more specific motion state is active.
- First-slice animation evaluates per-part frames only. Object position frames, motion-table-driven
  animation selection, animation hooks, and physics scripts are out of scope for `0x020003e5`.
- Retail `CPartArray` pose update uses the current integer part frame from `floor(frame_number)`.
  Do not invent pose interpolation for the first slice unless later evidence proves a different path
  is needed for another target.
- First-slice per-part frame playback must apply both part origin and part orientation from the
  active animation frame. The windmill target proves animated origins are required for visual parity.
- Animation DTOs should preserve typed hook summaries/invocations and report unsupported hooks so
  `0x020005ac` can become the next target by adding a `SetOmega` handler rather than reshaping the
  data model.

### Hook Dispatcher

Status: Proposed. Confidence: Medium-high.

- Add a small imperative hook dispatcher before broad hook execution is supported.
- Animation playback and future script playback should call the hook dispatcher directly when they cross
  a hook. No event bus is required for the first slice.
- Hook invocations should carry entity id, timeline source, asset id, frame/time, hook id/name, typed
  payload when decoded, and support/ownership classification.
- The hook dispatcher should apply only explicitly supported hook handlers and produce diagnostics for
  unsupported hooks.
- `SetOmega` is the first intended hook handler because the second target needs it for visual parity,
  but the routing and diagnostic shape should be hook-generic.
- Unsupported hook references must not be silently dropped. For first-slice rendering, unsupported
  hooks should warn and render as if the hook did not exist. Diagnostics must include enough context
  to identify the affected entity, source asset, frame/time, hook, and skipped effect.

### Dynamic Transform Inputs

Status: Proposed. Confidence: Medium-high.

- Dynamic transform integration is distinct from animation playback conceptually, but it does not need
  a separate first-target pass beyond feeding base pose and future transform state into
  `DynamicPlacementTracker`.
- It starts from the authoritative/base landblock-local entity frame provided by static seed facts or
  host/runtime entity state.
- Once needed, a separate ECS-like transform integration pass can own presentation integration for
  dynamic transform components such as velocity, acceleration, omega/angular velocity, and timed
  transform-adjacent effects like scale.
- Velocity, acceleration, and omega are first-class inputs because they already appear in host/server
  entity state and object-description payloads.
- Animation frame hooks such as `SetOmega` update dynamic transform state through the hook dispatcher;
  they do not become part of the animation part-frame sampler.
- `DynamicPlacementTracker` consumes the base pose plus current transform state and outputs the
  current object/part frames used by bounds, spatial indexing, and renderer submission.
- Frontend transform integration must not create authoritative truth. Host/runtime state remains the
  authority for entity existence, base pose, residence, collision, gameplay movement, and correction.

### Pose Composition

Status: Proposed. Confidence: Medium-high.

First-slice dynamic part placement should use this transform stack:

- active scene/residence anchor;
- entity landblock-local transform plus any runtime object-frame offsets;
- current part frame from the active animation, or setup/default placement frame when no animation is
  active;
- setup part scale.

Hook/effect modifiers such as scale or omega are deferred for the first target. They must compose
onto the entity/part pose later rather than replace the authoritative landblock-local entity pose.
`SetOmega` and similar transform-side effects can create large render-space movement around an
unchanged base entity pose when parts are offset from the object origin. That movement should update
dynamic render/culling bounds and spatial query records, but it should not by itself change
residence.
Do not compose setup/default placement and active animation part frame as if the animation were only
a delta. Retail `CSequence::get_curr_animframe` returns placement frames only when there is no
current animation; active animation frames are the current part frames.
Retail setup creation requests placement `0x65`, then `CPartArray::SetPlacementFrame` falls back to
placement `0` only. The current frontend helper also falls back to the lowest placement key; that is
useful diagnostics history, but it is not proven retail behavior.

### Renderer Submission

Status: Proposed. Confidence: Medium-high.

- Dynamic rendering should submit live per-part drawables instead of baked static draw units.
- Geometry/material resources should be shared where possible; per-entity/per-part transforms are
  live submission data.
- Dynamic part submissions should use the shared visual-resource/cache primitives from
  `docs/plans/holtburger-3d-shared-render-instance-static-instancing-plan.md`. They should not reuse
  `StaticObjectRenderInstance` directly while that contract remains static/outdoor-detail-specific.
- The old empty WebGL renderer `applyDynamicDelta()` placeholder has been removed. Dynamic renderer
  work must define a declarative dynamic scene commit API rather than building caller-authored
  diffing around a placeholder.
- First target can be outdoor-only and residence-aware: submit with the outdoor scene for its owning
  landblock, and submit nothing if residence is missing.
- Dynamic atlas packing and VAO compaction are deferred. WebGL2 instanced draws are also deferred as
  an optimization, but resource reuse and per-instance submission are not deferred.

### Scene Query And Bounds

Status: Proposed. Confidence: Medium-high.

- First-slice scene query can use conservative dynamic bounds and return semantic dynamic entity
  identity plus optional source/setup/part metadata.
- Bounds used for culling, diagnostics, and spatial query membership must be derived from current
  renderable geometry, not just the entity origin or bind/default setup pose. Swept or cycle bounds
  are deferred because they add policy and computation that the first slice does not need.
- Static and dynamic query records should merge into one scene query surface for callers.
- The dynamic runtime should spatially index all dynamically renderable records with meaningful
  bounds under their effective memberships. Selection, targeting, inspection, and debug behavior
  should be caller filters over that general query surface.
- Per-part precise bounds, triangle-level hits, effect hits, and gameplay-specific filters can be
  deferred as query filters or precision modes, but unsupported precision should be visible in
  diagnostics.
- Retail selection first tests part drawing spheres and can continue into polygon-accurate checks,
  returning object id plus part index. A first-slice AABB or conservative bounds query is therefore
  an intentional simplification, not parity.
- User retail-client visual check: both selected static-authored animated scenery targets are not
  selectable in retail. They should still be indexed for culling/inspection/debug queries; default
  browser/client selection filters should exclude them unless a debug query asks for them.

### Bridge And DTO Shape

Status: Proposed. Confidence: Medium-high.

- First-slice bridge work should focus on resource and seed facts needed by static-authored dynamic
  entities: source key, setup id, residence, landblock-local transform, default animation id, and
  decoded animation frames or an animation resource handle.
- DTO production and consumption should be explicit:
  - `StaticAuthoredDynamicSeedRecord` is created by the static source classification/resolution path
    when setup evidence requires dynamic handling, then consumed by the frontend dynamic runtime as a
    lifecycle/source fact.
  - `AnimationAssetPayload` is created by the Tauri host adapter/content asset route from decoded DAT
    animation data, validated by the frontend host contract layer, and consumed through the asset
    service/dynamic resource readiness path.
- Likely first-slice code homes:
  - producer/serializer for animation payloads: `apps/holtburger-3d/src-tauri/src/adapter/service.rs`
    and `apps/holtburger-3d/src-tauri/src/adapter/json.rs`;
  - frontend DTO validation: `apps/holtburger-3d/src/lib/host/contracts.ts`;
  - seed production: the static object source/resolver path that already classifies setup-backed
    static sources;
  - seed and animation consumption: the new frontend dynamic runtime/resource-readiness path.
- Do not stream per-frame animation transforms across the bridge.
- The existing `StaticAuthoredDynamicSeedRecord` contract only carries env-cell static object seeds.
  Outdoor static-authored dynamic seeds must be added before the proposed first target can be
  modeled honestly.
- Live timeline trigger DTOs, sequence/cancel ids, script-table resolution, and host-authoritative
  hook projection are deferred until live/spawned entities or script-bearing targets require them.
  Static-authored setup default animation startup can be derived from static seed facts for the first
  target.

### Reconciliation

Status: Proposed. Confidence: High for first slice.

- Host/static-scope truth wins.
- If source lifetime, source residence, base transform, setup id, or animation id changes, replace
  derived frontend state from the new source facts.
- Source residence changes replace the source fact, but effective presentation residence is still
  resolved from current frontend pose/bounds before renderer submission and spatial index sync.
- If animation id changes and no host timestamp is provided, restart playback from frame 0.
- If the entity despawns, the static scope evicts, or effective residence becomes unrenderable, remove
  renderer submissions immediately.
- If resources fail to load, mark the entity currently non-renderable with loud diagnostics while
  keeping the source record available for later retry/source refresh.
- First slice does not blend, predict, retime, or reconcile close-enough differences. That is future
  work once live entities or host-authored timeline starts enter scope.

### Dynamic Spatial Index

Status: Proposed. Confidence: Medium-high for first slice.

- First slice must define and implement the dynamic spatial index/query ownership shape because the
  immediate second target can move visible geometry far from the base entity origin through
  `SetOmega`.
- Reuse the existing outdoor landblock-grid traversal for candidate landblocks. Dynamic outdoor query
  should run inside the same candidate loop as terrain/outdoor static roots so it inherits current
  reanchoring behavior and nearest-hit pruning.
- Add a per-landblock outdoor dynamic index using a proven mutable 2D AABB hierarchy, preferably an
  R-tree/RBush-style structure, rather than a flat list or bespoke spatial tree. The implementation
  can choose the exact package or local wrapper during implementation, but the structure should remain
  swappable behind a small local interface.
- Each outdoor dynamic index item should store current-frame landblock-local 2D AABB fields for the
  broad phase, the current 3D bounds for narrow-phase ray/AABB checks, semantic dynamic entity id,
  residence/source metadata, and precision metadata.
- The first implementation must support per-landblock effective residence membership, update/removal,
  current-frame bounds, precision metadata, and merged static/dynamic query results.
- Effective outdoor residence should be resolved from current frontend pose/bounds. The primary
  effective landblock can come from current object origin, while index membership should include every
  outdoor landblock overlapped by current-frame bounds so cross-boundary entities remain queryable.
- Effective residence/index membership can be polling-and-diff based during `DynamicPlacementTracker`
  updates. At the expected first-slice scale, no event bus or host feedback path is needed.
- Env-cell resident dynamic indexes can stay flat by env-cell membership for now.
- Bounds records should be landblock-local so later spatial indexing follows the same reanchoring
  rule as static draw units.
- Swept/cycle bounds are deferred. `SetOmega` and animation playback should update current-frame
  bounds as the entity moves instead of attempting to precompute the whole animated envelope.

### Diagnostics

Status: Proposed. Confidence: High.

- First-slice diagnostics must show why a static source was classified dynamic, source residence,
  effective presentation residence, setup id, animation id, resource readiness, current animation
  frame/time, renderer submission count, missing dependencies, and unsupported animation hooks.
- Diagnostics should make it obvious when an entity is currently non-renderable because resources are
  missing or because it has no renderable effective residence.
- First-slice validation can rely on debug diagnostics for manual inspection. Diagnostics should
  expose decoded setup/animation facts, current runtime frame, part count, part transforms or bounds,
  dynamic index membership, renderer submission count, and any skipped unsupported hooks.

### First-Slice Tightening Checklist

Status: proposed. Confidence: medium-high.

These are the implementation-facing answers that need to be pinned before writing phases:

- Validation surface: debug diagnostics are the primary first-slice validation tool. They must expose
  enough asset, runtime, renderer, and query state for manual inspection of `0x020003e5`.
- DTO ownership: static source classification/resolution creates static-authored dynamic seed facts;
  the Tauri/content asset route creates animation asset payloads; frontend host contracts validate
  both; `DynamicEntityController` consumes seed facts and requests animation assets through the asset
  service.
- Spatial index strategy: reuse the existing outdoor landblock-grid traversal as the outer broad
  phase, then use a per-landblock R-tree/RBush-style mutable AABB index with current-frame
  landblock-local bounds. Env-cell dynamic membership can stay flat for now.
- Unsupported hooks: warn through diagnostics/console and render as if unsupported hooks did not
  exist for the first slice. Missing required resources still make the entity currently
  non-renderable without creating a durable failure record.
- Renderer contract: resource commits and instance commits stay separate. Renderer handles are
  derived output, while semantic dynamic entity state remains owned by the frontend dynamic runtime.

### First-Slice Dynamic Entity Modules

Status: proposed. Confidence: medium-high.

The first slice should use a hybrid dynamic entity controller, not a full ECS. Some modules are
ECS-like passes over typed records, while others are imperative services because they cross async,
diagnostic, hook-routing, or tightly coupled update boundaries. The useful abstraction is clear
ownership and update order rather than generic components, queries, events, or archetypes.

High-level tick/reconcile flow:

```text
static source classification
  -> DynamicEntityController.ingestStaticSeed()

DynamicEntityController.reconcileStaticScopes()
  -> remove evicted source records
  -> remove renderer submissions
  -> remove spatial index entries

DynamicEntityController.tick(dt)
  -> DynamicEntityResourceManager.ensureReady(record)
  -> DynamicAnimationPlayer.advance(record, dt, hookDispatcher)
  -> DynamicPlacementTracker.update(record)
  -> DynamicEntityController.commitRendererSnapshot()
```

First-slice modules:

- `DynamicEntityController`: owns the store, static-scope reconciliation, update order, and renderer
  commit production. It is the coordinator, not a generic ECS scheduler.
- `DynamicEntityStore`: typed `Map<DynamicEntityId, DynamicEntityRecord>` with nested typed state for
  provenance, source residence, effective presentation residence, resources, animation, transform,
  renderability, bounds/index membership, and current issues. First-slice ECS-like passes iterate
  these records directly; component arrays/maps are deferred until measured iteration pressure or
  proven requirements justify extraction.
- `DynamicEntityResourceManager`: requests setup, part/gfx/material/texture resources, and animation
  assets. It is async orchestration/service behavior, not an ECS system. Missing required assets
  produce loud console diagnostics and transient non-renderable state; source records remain alive for
  later retry/source refresh.
- `DynamicAnimationPlayer`: advances setup default animation from static seed facts, samples integer
  part frames, and calls the hook dispatcher directly when a hook is crossed. This is ECS-like: it can
  iterate records with active animation state and update typed animation/pose inputs.
- `DynamicHookDispatcher`: shared imperative hook interpreter/router. Animation playback uses it first;
  future physics-script playback should call the same dispatcher. It applies supported hooks directly
  and warns/diagnoses unsupported hooks.
- `DynamicPlacementTracker`: imperatively composes current object/part transforms, computes
  current-frame bounds, resolves effective frontend presentation residence, and synchronizes outdoor
  dynamic spatial index entries when bounds, effective residence, or membership changes. It consumes
  animation output and runtime transform state, but it should not be a separate ECS pass because
  pose, bounds, effective residency, and index sync are tightly coupled for the first slice.
- `OutdoorDynamicSpatialIndex`: owns the per-landblock R-tree/RBush-style mutable AABB indexes used
  after existing landblock-grid candidate traversal.
- Dynamic renderer commit: `DynamicEntityController` builds and applies a coherent dynamic renderer
  snapshot after resource, animation, placement, bounds, and index state are current. This can use
  helper functions, but it does not need a separate ECS-style builder module for the first slice. It
  can reuse static material, geometry, texture, shader, upload, and batching helpers where the facts
  are isomorphic, but it must not bake animated transforms into static draw units or make renderer
  handles the semantic dynamic identity.
- Diagnostics API: read-only projection from runtime records, current issues, renderer submission
  counters, and spatial index membership. Do not create a standalone diagnostics system unless the
  application already has a matching diagnostic registry pattern.

Module shape summary:

```text
imperative/orchestration:
  DynamicEntityController
  DynamicEntityResourceManager
  DynamicHookDispatcher
  DynamicPlacementTracker
  dynamic renderer snapshot/commit
  Diagnostics API

ECS-like typed record passes:
  DynamicAnimationPlayer
  Dynamic transform integration, once needed beyond first-target static seed pose

data/index owners:
  DynamicEntityStore
  OutdoorDynamicSpatialIndex
```

Imperative hook call shape:

```text
DynamicAnimationPlayer.advance(record, dt)
  -> crosses animation frame hook
  -> DynamicHookDispatcher.applyAnimationHook(record, hookInvocation)
       -> supported handler mutates typed runtime state
       -> unsupported handler logs and records diagnostics

Future DynamicScriptPlayer.advance(record, dt)
  -> crosses script hook
  -> DynamicHookDispatcher.applyScriptHook(record, hookInvocation)
```

Placement, effective residency, bounds, and index coupling:

```text
DynamicPlacementTracker.update(record)
  -> current object frame
  -> current part transforms
  -> current-frame landblock-local bounds
  -> resolve effective presentation residence
  -> diff effective outdoor landblock memberships
  -> upsert/remove items in OutdoorDynamicSpatialIndex
  -> expose precision = current-frame-aabb
```

Renderer reuse boundary:

```text
reuse:
  shared visual resource/cache contracts
  static material planning where part-agnostic
  prepared gfx/material/texture resources
  shared object visual resource cache where keys are isomorphic
  shader/material binding helpers
  renderer upload/batching helpers where they accept live transforms

do not reuse as:
  baked static vertices for animated parts
  static layer lifetime as dynamic entity lifetime
  static draw-unit id as semantic dynamic entity id
  StaticObjectRenderInstance as the dynamic entity instance contract
```

## Investigation Worksheet

Use this worksheet to track evidence-gathering before implementation phases are written. Mark items
as `pending`, `in progress`, `answered`, or `blocked`, and link the exact files, commands, or
reference snippets that support each conclusion.

### Frontend Static Pipeline And Resource Readiness

Status: answered. Can investigate independently.

Evidence to collect:

- Current static setup/material preparation path.
- Where setup parts, material resources, and texture dependencies become renderer-ready.
- Whether animation assets are exposed through existing Tauri/host contracts.
- Existing missing-resource behavior for static objects.

Likely sources:

- `apps/holtburger-3d/src/lib/static/**`
- `apps/holtburger-3d/src/lib/assets/**`
- `apps/holtburger-3d/src-tauri/src/adapter/service.rs`
- `apps/holtburger-3d/src-tauri/src/adapter/json.rs`
- `apps/holtburger-3d/src/lib/host/contracts.ts`

Should upgrade:

- Resource Readiness confidence.
- Bridge And DTO Shape confidence.
- Diagnostics requirements for missing dynamic dependencies.

Evidence found:

- `apps/holtburger-3d/src-tauri/src/adapter/json.rs` serializes setup payloads with
  `defaultAnimation`, setup parts, placement sets, collision witnesses, and gfx dependencies.
- `apps/holtburger-3d/src/lib/host/contracts.ts` validates those setup fields, but there is no
  animation payload schema and `apps/holtburger-3d/src/lib/host/tauri.ts` does not route
  `animation/*` asset ids.
- `apps/holtburger-3d/src/lib/static/objects/static-object-source-closure.ts` loads setup
  appearance, gfx objects, materials, palettes, render surfaces, and texture refs while recording
  missing refs. This path is useful for dynamic setup resource discovery, but the final dynamic
  renderer should not depend on baked static draw-unit output.

Conclusion:

- Resource readiness can reuse current setup/gfx/material dependency discovery where the facts are
  isomorphic.
- Dynamic playback needs a first-class animation asset lookup/payload.
- Missing dynamic dependencies should follow the existing explicit missing-ref diagnostic pattern and
  make the entity currently non-renderable rather than falling back to baked static geometry. This
  should be transient runtime state, not a durable failure record.

### Pose Composition

Status: answered. Can investigate independently.

Evidence to collect:

- Existing frontend setup placement order.
- Static bake order for source frame, setup placement, parent chain, scale, and part transforms.
- ACViewer or retail evidence for applying animation frames to setup parts.
- Whether current frontend helpers can be reused for dynamic pose derivation.

Likely sources:

- `apps/holtburger-3d/src/lib/static/objects/static-object-source-closure.ts`
- `crates/holtburger-content/src/landblock_scene_assets.rs`
- ACViewer setup/animation render path.
- Retail `CPartArray` / animation-frame application only if ACViewer and local code do not settle
  transform order.

Should upgrade:

- Pose Composition confidence.
- Dynamic Bounds confidence.
- Renderer Submission transform contract.

Evidence found:

- `apps/holtburger-3d/src/lib/static/objects/static-object-source-closure.ts` selects setup
  placement set `0x65`, then `0`, then lowest key, and currently adds holding/connection-point
  placements to static part default placements.
- `apps/holtburger-3d/src/lib/static/objects/bake/static-object-compatibility-baker.ts` bakes
  object local placement, default part placements, and source/part scale into static vertices.
- `crates/holtburger-content/src/landblock_scene_assets.rs` uses the same default placement
  selection order for static bounds and combines object placement with part placement.
- `crates/holtburger-dat/src/file_type/animation.rs` stores animation `pos_frames` separately from
  per-frame `part_frames`; ACViewer/ACE `Sequence.Update` advances pos frames and executes hooks as
  runtime state.

Conclusion:

- Dynamic pose should be a live transform stack, not another static bake: residence/scene anchor,
  landblock-local entity pose, current part frame from active animation or setup/default placement
  when no animation is active, and part scale.
- Object position frames are runtime movement offsets and remain out of first target scope because
  both selected static candidates have zero pos frames.

### Renderer Submission And Material Binding

Status: answered. Can investigate independently.

Evidence to collect:

- Current renderer API for adding, removing, and updating non-baked drawables.
- Whether any dynamic/debug drawable path already exists.
- How material bindings, transparency sorting, and portal/env-cell submissions are keyed.
- Whether live per-part transforms can reuse prepared static geometry/material handles.

Likely sources:

- `apps/holtburger-3d/src/lib/renderer/**`
- `apps/holtburger-3d/src/lib/static/**`
- portal renderer path in the current frontend.

Should upgrade:

- Renderer Submission confidence.
- Resource Readiness confidence.
- Frontend Runtime Shape module order.

Evidence found:

- `apps/holtburger-3d/src/lib/renderer/types.ts` exposes static landblock layer payloads and
  env-cell resource membership keyed by draw-unit ids.
- `apps/holtburger-3d/src/lib/renderer/webgl2/webgl2-renderer.ts` owns static GPU resources by
  layer, disposes them through `#replaceStaticLayer`, and renders static object resource sets per
  outdoor or env-cell scene domain.
- The old empty `applyDynamicDelta()` method has been removed; there is no dynamic resource/instance
  commit API yet.
- Static object material pass and transparency behavior are tied to baked static object draw-unit
  resources.
- `docs/plans/holtburger-3d-shared-render-instance-static-instancing-plan.md` established the
  precursor for splitting reusable visual resources from per-instance placement for generated outdoor
  statics. Future dynamic entity parts should reuse the visual-resource/cache model, not the
  static-only render-instance identity type.

Conclusion:

- Dynamic renderer work should add a real dynamic resource/instance commit path instead of mutating
  static draw units.
- Prepared geometry/material facts should be shared through the established visual-resource/cache
  model, while first-slice dynamic rendering still owns live per-part transforms and scene-domain
  membership.
- The deleted `applyDynamicDelta()` placeholder remains a design warning: dynamic rendering still
  needs a final declarative dynamic commit API.

### Scene Query And Bounds

Status: answered. Can investigate independently.

Evidence to collect:

- Current static picking query shape and selection key model.
- Whether picking uses mesh hits, CPU bounds, BVH, renderer id buffers, or another path.
- How source ids and renderer ids are surfaced through interaction/debug code.
- Whether first-slice dynamic bounds can live in a frontend-local collection.

Likely sources:

- `apps/holtburger-3d/src/lib/**/picking*`
- `apps/holtburger-3d/src/lib/static/**`
- renderer selection query path.
- browser interaction/controller code.

Should upgrade:

- Scene Query And Bounds confidence.
- Dynamic Spatial Index first-slice choice.
- Bridge DTO Inventory query payloads.

Evidence found:

- `apps/holtburger-3d/src/lib/browser/static-picking.ts` creates camera rays for
  `StaticScenePickRequest`.
- `apps/holtburger-3d/src/lib/runtime/static-scene-query.ts` merges terrain, outdoor static, and
  env-cell static hits through BVH-backed AABB intersection and returns semantic
  `StaticSceneSelectionKey` variants.
- Env-cell static picking currently intersects stored seed/object bounds; outdoor picking uses
  object instance bounds from static spatial records.

Conclusion:

- First-slice dynamic query records can live beside static query records as a dynamic bounds
  collection, then merge hits by distance into the caller-facing scene query.
- Dynamic query hits should return semantic dynamic entity identity plus optional setup/source/part
  metadata, matching the static selection-key style.
- Per-triangle dynamic query precision can be deferred; conservative bounds are honest if diagnostics
  expose the precision level.

### Bridge DTO And Host Contract Shape

Status: answered. Can investigate independently.

Evidence to collect:

- Existing Tauri contract style for content lookup and static scene/resource payloads.
- Whether animation assets should be independent content lookups or included in setup/dynamic
  resource payloads.
- Host-to-frontend scene update flow and current DTO naming conventions.
- Existing diagnostics/failure payload style.

Likely sources:

- `apps/holtburger-3d/src-tauri/src/adapter/service.rs`
- `apps/holtburger-3d/src-tauri/src/adapter/json.rs`
- `apps/holtburger-3d/src/lib/host/contracts.ts`
- current static asset request and response types.

Should upgrade:

- Bridge And DTO Shape confidence.
- Resource Readiness confidence.
- Reconciliation data requirements.

Evidence found:

- Existing host contracts use explicit zod schemas and source provenance for each content payload.
- Setup payloads include `defaultAnimation` and default script/table ids, but not animation frame
  data.
- The Tauri asset route switch handles setup, material, setup appearance, texture, and binary
  geometry/texture routes, but no animation route.
- `StaticAuthoredDynamicSeedRecord` currently aliases only env-cell static object seed records;
  outdoor static-authored dynamic seeds are not represented yet.

Conclusion:

- Add animation as a first-class content payload/route with decoded frame and hook summary data.
- Add outdoor static-authored dynamic seed records before implementing the proposed outdoor first
  target.
- Keep bridge DTOs at authored facts and timeline triggers; do not stream per-frame pose transforms
  from host to frontend.

### Static Lifecycle And Reconciliation

Status: answered. Can investigate independently.

Evidence to collect:

- How static scopes enter, update, evict, and dispose renderer resources.
- Whether static source identity is stable across scene updates.
- Existing pending/ready/failed resource transition patterns.
- Existing disposal/cancellation patterns for renderer submissions.

Likely sources:

- static scene coordinator and asset loading code.
- renderer disposal/update paths.
- diagnostics for failed static resources.

Should upgrade:

- Reconciliation confidence beyond first-slice policy.
- Entity Store And Lifetime confidence.
- Diagnostics requirements for static-scope eviction and resource failure.

Evidence found:

- `apps/holtburger-3d/src/lib/static/coordinator/static-coordinator.ts` reconciles desired static
  demand by revision, evicts resident resources outside the desired key set, drops stale resolver and
  bake results, and emits explicit commit deltas.
- Static work statuses are `requested`, `resolving`, `source-committed`, `baking`, `committed`, and
  `failed`.
- Static resolver and asset reader clients reject pending work on dispose instead of silently
  ignoring it.

Conclusion:

- Static-authored dynamic entity lifetime should be keyed to static source/scope identity and evicted
  with the owning static scope.
- Dynamic reconciliation should use the same explicit revision/current-work pattern: stale static
  seeds do not mutate live dynamic state, and scope eviction removes dynamic submissions.
- Diagnostics should include source revision/scope, seed status, dynamic resource readiness, and
  stale/evicted counters where useful.

### SetOmega And Immediate Hook Policy

Status: answered. Can investigate independently.

Evidence to collect:

- Retail `SetOmegaHook::Execute` behavior and whether it affects object angular velocity, visual
  spin, physics simulation, or both.
- ACViewer hook parser payload interpretation.
- Whether `0x020005ac` can be treated as a presentation-only second target or requires a
  both-projected hook policy.
- Whether unsupported `SetOmega` can be reported while still rendering base animation honestly.

Likely sources:

- `acclient-eor-source/acclient.c` `SetOmegaHook::Execute` and `CPhysicsObj::set_omega`.
- ACViewer animation hook classes.
- `crates/holtburger-debug-harness` candidate trace output for `0x020005ac`.

Should upgrade:

- Hook Ownership Matrix first rows.
- Animation Runtime second-target scope.
- Pose Composition hook/effect modifier ordering.

Evidence found:

- Retail `SetOmegaHook::Execute` calls `CPhysicsObj::set_omega(object, &this->axis, 1)`, and
  `set_omega` writes `m_omegaVector`.
- ACViewer/ACE `SetOmegaHook` reads a `Vector3 Axis`; `MotionTable.add_motion` also writes sequence
  omega from motion data.
- `crates/holtburger-dat/src/file_type/setup_model.rs` currently keeps hook type `22` as raw
  12-byte payload instead of a typed vector payload.
- The harness trace for `0x020005ac` shows animation `0x03000751` has one frame-0 `SetOmega` hook.

Conclusion:

- `SetOmega` is both-projected runtime state, not presentation-only material behavior.
- First target `0x020003e5` can ignore hooks because it has none.
- Second target `0x020005ac` should initially report unsupported `SetOmega` while still rendering
  base part-frame animation, unless the implementation adds typed SetOmega decoding and a frontend
  angular-velocity modifier. Retail visual parity for this target requires that modifier.

### Equipment And Attachments

Status: answered for code shape; blocked for visual/live confirmation.

Evidence to collect:

- Live object/equipment payload shape.
- Whether equipped/wielded items are independent server entities, visual composition, or both.
- Existing world/core entity APIs for equipment and parent-child relations.
- Protocol object description fields relevant to equipment/attachments.

Likely sources:

- ACE object create/update/equipment handling.
- `holtburger-world` entity state.
- `holtburger-core` entity projections.
- `holtburger-protocol` object description and equipment properties.

Should upgrade:

- Equipment And Attachments worksheet answers.
- Entity Store And Lifetime child identity policy.
- Bridge DTO Inventory for later live/spawned entities.

Evidence found:

- `crates/holtburger-protocol/src/messages/object/messages/description.rs` exposes object
  `container_id`, `wielder_id`, `valid_locations`, `currently_wielded_location`, physics
  `parent_id`, `parent_loc`, and child GUID/location pairs.
- `crates/holtburger-protocol/src/messages/object/messages/properties.rs` exposes `ParentEventData`
  with parent GUID, child GUID, location, placement, parent instance sequence, and child position
  sequence.
- ACE physics `PhysicsObj.UpdateChild`, `add_child`, and `set_parent` combine parent part frame or
  object frame with the child frame and move the child into the parent cell.
- ACE world-object code treats equipped/wielded items as separate world objects with
  `WielderId`/`CurrentWieldedLocation`; combat/magic code often redirects item targets to the
  wielder.

Conclusion:

- Equipment and attachments can be represented as independent dynamic entities when the server gives
  them GUID identity, lifetime, parent events, or independent query/selection metadata.
- Visual parenting is a relation on top of entity identity, not a reason to make residency per part.
- Live capture or user visual confirmation is still needed before committing detailed player
  equipment rendering and query/selection requirements.

### Retail Decompile Follow-Up

Status: answered for the targeted retail paths. Broader parity questions should stay scoped to exact
symbols inspected because the retail decompile is unofficial and incomplete.

Evidence targets covered:

- `CPartArray` and `CSequence` transform order for setup/default placement, animation part frames,
  scale, object frame, and child part frames.
- Animation frame interpolation, loop/range behavior, reverse playback, and hook firing timing.
- `m_omegaVector` integration and reset/overwrite behavior.
- Attachment/child update order relative to parent part animation and inherited state.
- Default setup animation/script startup behavior for static scenery and normal physics objects.
- Physics script effect application for durable state versus transient presentation.
- Picking/bounds witnesses used by retail selection.

Likely sources:

- `acclient-eor-source/acclient.c` symbols for `CPartArray`, `CSequence`, `CPhysicsObj`,
  animation hooks, script hooks, child update, and selection/intersection helpers.
- ACE/ACViewer equivalents only as cross-checks where retail names are unclear.

Should upgrade:

- Pose Composition confidence.
- Animation Runtime confidence beyond the hook-free first target.
- Hook Ownership Matrix confidence.
- Attachment and dynamic bounds requirements.
- Scene query precision requirements.

Evidence found:

- `CPartArray::CreateSetup` calls `SetPlacementFrame(0x65)`. `SetPlacementFrame` then falls back to
  placement key `0` if the requested key is missing; it does not use the current frontend helper's
  lowest-key fallback.
- `CPartArray::InitDefaults` appends the setup default animation with `low_frame = 0`,
  `high_frame = -1`, and `framerate = 30.0`. `CPhysicsObj::InitDefaults` marks static objects with
  default animation/default script state and adds them to `CPhysics::static_animating_objects`.
- `CSequence::get_curr_animframe` returns the placement frame when there is no current animation, or
  `AnimSequenceNode::get_part_frame(curr_anim, floor(frame_number))` when animation is active.
- `CPartArray::UpdateParts` combines the object frame with the current per-part animation frame and
  part-array scale for every part.
- `CSequence::update_internal` advances frame time, crosses integer frame boundaries, applies
  animation position frames, applies sequence velocity/omega, and executes hooks for the crossed
  part frame. Positive playback uses hook direction `1`; negative playback uses hook direction `-1`;
  hook direction `0` fires in either direction.
- `AnimSequenceNode::multiply_framerate` swaps low/high frame bounds when playback speed becomes
  negative. Sequence end queues `AnimDoneHook` behavior and advances to the next animation node.
- `CPhysicsObj::animate_static_object` ticks static authored animation by updating the part array,
  rotating the object frame by `m_omegaVector`, updating parts, updating children, updating scripts,
  updating particles, and then processing queued hooks.
- Animation hooks are queued into `anim_hooks` during sequence update and are executed later by
  `CPhysicsObj::process_hooks`. Hook effects include no-draw, ethereal, transparency, luminosity,
  diffuse color, scale transitions, particle creation/destruction, default-script chaining,
  part-default-script chaining, and `SetOmega`.
- `SetOmegaHook::Execute` calls `CPhysicsObj::set_omega`, which writes `m_omegaVector`. For static
  animated objects, `m_omegaVector` is integrated by `animate_static_object`, so `SetOmega` is
  transform-affecting runtime state rather than a cosmetic material-only effect.
- `CPhysicsObj::set_parent`, `add_child`, and `UpdateChildrenInternal` treat children as separate
  physics objects with parent/part-frame relations. Child placement is recomputed after parent part
  animation updates; parent no-draw can propagate to the child when parenting is established.
- Retail selection transforms the selection ray into each part's local frame, tests the part mesh
  drawing sphere, and can continue into polygon-accurate checks. Selection returns the object id and
  part index from either the sphere or polygon hit.

Conclusion:

- Default setup animation is automatic runtime behavior for static authored objects, not passive
  metadata. The first dynamic static target should start its setup default animation without a host
  timeline trigger.
- First-slice part pose evaluation can use integer frame stepping. Retail evidence did not show
  interpolation in the `CPartArray` per-part pose path inspected here.
- The dynamic transform stack should preserve the static local-space pattern: landblock-local object
  frame plus the current part frame from active animation, or setup/default placement when no
  animation is active, with scene-space values derived at submission/query time.
- Animation position frames and sequence velocity/omega are separate runtime offsets from per-part
  frames. They can stay out of the hook-free first target, but the data model should keep them
  distinct for motion-table and live-entity work.
- Hook handling should model the separation between a crossed/queued hook invocation and the applied
  effect.
  Effects may be durable state, timed transitions, asset-backed presentation, script chaining, or
  both-projected transform state.
- Static authored `SetOmega` needs explicit second-target policy. Rendering `0x020005ac` without
  omega support is acceptable only if diagnostics call out that the transform-affecting hook is
  unsupported.
- Dynamic bounds should be derived from current part frames and scale, not only from bind/default
  setup pose. Conservative first-slice bounds are acceptable, but static baked bounds are not enough
  for animated dynamic entities.
- Retail picking is more precise than the proposed first-slice query. Dynamic scene query can start
  with conservative semantic bounds, but the design should leave room for per-part sphere/polygon
  hits and part index reporting.

### Target Asset Motion Investigation

Status: answered for `0x020003e5` and `0x020005ac`. Can investigate independently.

Evidence targets covered:

- Decode setup placements, parent indices, selection spheres, default animation ids, default scripts,
  and part lists for the two candidate static-authored dynamic targets.
- Decode default animation position-frame count, per-part frame movement, hooks, and hook payloads.
- Determine whether observed retail motion is explainable from authored animation frames and hooks.

Likely sources:

- `crates/holtburger-debug-harness/src/bin/inspect_static_source_asset.rs`
- `crates/holtburger-dat/src/file_type/animation.rs`
- `crates/holtburger-dat/src/file_type/setup_model.rs`

Evidence found:

- Command used: `cargo run -p holtburger-debug-harness --bin inspect_static_source_asset -- --did
  0x020003e5 --did 0x020005ac`.
- `0x020003e5` has setup placement key `0`, no selection sphere, no default script, no motion table,
  no sound table, and no script table. Its default animation `0x0300061b` has 5 parts, 60 frames, no
  position frames, and no hooks.
- `0x0300061b` animates part origins and orientations. Four blade parts have sampled
  `maxOriginDelta` about `7.47`, while the hub part has fixed origin and changing orientation. The
  retail "whole object rotates" impression is explainable from per-part frame playback.
- `0x020005ac` has setup placement key `0`, no selection sphere, no default script, no motion table,
  no sound table, and no script table. Its default animation `0x03000751` has 2 parts, 7 frames, no
  position frames, and one frame-0 `SetOmega` hook.
- `0x03000751` keeps both part origins fixed at approximately `(-0.000001, -12.0, 15.0)` while
  changing part orientations. The `SetOmega` hook payload decodes as vector
  `(0.0, 0.0, -0.038397)`.

Conclusion:

- The first target does not require object-level omega or animation position frames. It does require
  active animation part frames to replace the setup placement frame and to carry both origin and
  orientation.
- The second target likely composes fixed offset part frames, wing-flap orientation animation, and
  persistent object-frame omega. It is the correct next target for validating `SetOmega` and
  transform-side hook integration.
- The second target proves transform hooks can create large renderable spatial variance without
  animation position frames or physics scripts. Dynamic bounds and spatial index records must account
  for the current-frame geometry of those effects.
- Both targets have zero selection sphere and are user-confirmed unselectable in retail, so dynamic
  rendering must not imply default selection inclusion. They can still participate in debug or
  inspection queries through filters.

### User-Assisted Evidence

Status: partially answered. Requires additional user or running-client context for broader live
entities.

Evidence to collect:

- Visual confirmation that `0x020003e5` and `0x020005ac` animate in retail, ACViewer, or the current
  frontend once dynamic playback exists.
- Product decision on synthetic browser-mode dynamic entities for validation versus only real
  DAT/static-scene targets.
- Product decision on when simple dynamic bounds stop being sufficient and a real broadphase is
  required.
- Live capture/server examples for equipment/attachments if repository data is insufficient.

Evidence found:

- User retail-client visual check: `0x020003e5` is windmill blades rotating continuously in place as
  soon as the scene loads; the entire object appears to rotate.
- User retail-client visual check: `0x020005ac` is a bird flapping its wings while circling a spot
  continuously as soon as the scene loads. The observed behavior suggests part-frame animation plus
  transform-side circular motion, likely involving `SetOmega` and an offset from the rotation center.
- User retail-client visual check: neither `0x020003e5` nor `0x020005ac` is selectable in retail.
- User retail-client visual check: equipped weapons and shields are independently selectable and
  appear parented to character avatar attachment points. Armor and similar worn equipment are not
  selectable and appear to replace body parts.

Conclusion:

- The first target remains valid. The asset dump resolves the windmill motion as animated per-part
  origin/orientation frames rather than an object-level omega requirement.
- The second target should be treated as the first `SetOmega`/offset-motion validation target, not
  merely a decorative hook example.
- Dynamic rendering does not imply default selection inclusion. Browser/client mode should express
  selection policy as filters over the general scene query surface.
- Equipment modeling should distinguish independent selectable child entities, such as weapons and
  shields, from non-selectable visual body-part replacement, such as armor.

Should upgrade:

- First-slice validation strategy.
- Dynamic Spatial Index scope.
- Equipment And Attachments scope.

## Requirements Discovery Tracks

These tracks are not implementation phases. They are the requirement areas that must be understood
before we schedule implementation. Detailed open questions live in the discovery worksheet above.

### Entity Sources And Authority

Worksheet coverage: first target, source/authority classification, bridge DTO inventory, and
static-seed versus live-entity reconciliation.

Required evidence:

- ACE world/session handling for entity creation, updates, deletion, motion, animation, and equipment.
- Existing `holtburger-world` / `holtburger-core` entity and motion state contracts.
- At least one evidence-backed static-authored dynamic seed candidate before seed implementation.

### Identity, Lifetime, And Residency

Worksheet coverage: lifecycle matrix, entity/resource/renderer identity, no-residence behavior,
attachment classification, and resource lease/eviction policy.

Requirement direction:

- Dynamic service owns dynamic instance/resource lifetime.
- Static coordinator owns only seed discovery and seed lifetime relation to the owning static scope.
- Renderer owns GPU realization lifetime for committed dynamic resources and instances.
- Static-authored dynamic entities inherit residence lifetime from their owning static scope.
- Spawned dynamic entities have explicit lifetime and explicit destruction.
- Spawned dynamic entities may be requested by host/runtime or browser/future client mode. The
  frontend runtime should normalize both into the same dynamic entity lifecycle shape, with source
  metadata carrying authority, owner, query tags/filter defaults, and destruction policy differences.
- Spawned dynamic residence is weak: it can decide render placement while available, but it must not
  create scene interest or retain static layers.
- The system needs a defined unrendered/no-residence state for spawned objects that are valid runtime
  entities but not currently resident in a renderable scene domain.
- Residence is owned at dynamic entity granularity, not per rendered part. Parts, setup placements,
  animation-local transforms, replacement visuals, and part-anchored effects inherit the entity's
  residence.
- Attachments become separate resident dynamic entities only when their source identity/lifetime or
  authority is independent, such as server-owned wielded items, projectiles, independently movable
  child objects, or separately queryable/destructible entities.
- Dynamic entity position, rotation, and bounds records are stored in landblock-local space.
  Scene-space or renderer-local placement is derived at submission time from the active
  anchor/residence, matching static draw-unit anchoring.
- Runtime animation and hook playback can expand or move renderable bounds without changing
  residence. Residence remains an entity-level authority/scope fact; animated bounds movement is a
  rendering, culling, scene-query, and diagnostics concern unless the host/runtime changes the
  entity's authoritative residence.

### Visual Resource Composition

Worksheet coverage: first-target dependency trace, equipment/attachment composition, hook effect
dependencies, dynamic bounds, resource lifetime, and reusable material pipeline boundaries.

Required evidence:

- ACViewer setup/model/material/animation handling for representative creatures, players, and
  equipment-bearing objects.
- ACE or retail-client evidence for model/update payload interpretation.

### Motion, Animation, And Attachments

Worksheet coverage: timeline lifecycle, hook ownership matrix, bridge timeline triggers, host/frontend
drift, transform composition, and attachment policy.

Requirement direction:

- Runtime/world owns authoritative entity state and movement interpretation.
- Dynamic service owns render-readiness and animation/resource state derived from authoritative
  entity state.
- Renderer consumes committed instance transforms/animation parameters for the current dynamic scene
  state.
- Frontend dynamic runtime keeps animation playback distinct from transform state. Animation playback
  samples authored local part frames and calls the hook dispatcher when hooks are crossed. A separate
  transform integration pass should be added when velocity, acceleration, omega, or supported
  transform hooks require object-frame advancement beyond the first target's base pose.
- Setup, animation, motion table, physics script, physics script table, and PlayScript concepts stay
  distinct in the requirements and implementation shape.
- Setup scripts, animation hooks, script-table lookups, direct script playback, and PlayScript events
  are allowed to affect render state. The first slice must explicitly choose which subset is
  supported and which subset is deferred.
- Animation and script handling remain requirements-discovery topics for exact first-target coverage,
  but the high-level split is proven: motion tables drive authored animation selection, while physics
  scripts drive timed hook/effect execution.
- Physics scripts do not own durable object position. Transform-affecting hook effects such as scale
  or omega compose onto the dynamic entity's authoritative landblock-local pose instead of replacing
  it.
- Transform-affecting hooks can still create large spatial envelopes. `SetOmega` on an object with
  offset part frames can sweep geometry around the entity origin while the authoritative/base
  position remains fixed.
- Velocity, acceleration, and omega should be modeled as dynamic transform components that can be
  driven by host state, setup/motion data, or supported timeline hooks. This is rudimentary transform
  integration, not a frontend authority or full physics engine.
- Frontend presentation motion can change effective render/query residence even when source residence
  remains unchanged. This is required for later projectiles, creatures, players, and other
  velocity/motion-driven entities, and it is also relevant to first-slice transform effects whose
  bounds can cross landblock boundaries.
- Host/runtime and frontend runtime consume shared decoded timeline data through separate
  projections. Host/runtime evaluates authoritative hooks and state changes; frontend evaluates
  presentation pose, render, audio, and effect playback.
- `Attack` and `Ethereal` are expected to be host-authoritative. `Sound`, material transitions,
  texture velocity, and particle playback are expected to be frontend-presentation. `NoDraw`, `Scale`,
  `SetOmega`, `DefaultScript`, and `DefaultScriptPart` require first-target policy because they may
  affect state, sequencing, collision, visibility semantics, or bounds.

### Renderer Contract

Worksheet coverage: bridge DTO inventory, resource versus instance commits, residence-aware
submission, query metadata, diagnostics, transparency, and instancing constraints.

Requirement direction:

- Renderer receives declarative dynamic resource and instance commits/snapshots; it does not hydrate
  assets or inspect source DTOs. Internal renderer diffing for GPU reuse is acceptable, but caller-
  authored dynamic diffs should not be the public contract.
- Dynamic instance placement uses the same runtime-owned renderer-local placement layer as static
  draw units.
- Dynamic instance records carry landblock-local transforms/bounds. Renderer-facing submission may
  include derived scene-local transforms for the current frame/anchor, but those derived values must
  not become the durable dynamic entity record.
- Dynamic renderer identity must not be the semantic entity identity, but it must map back to it for
  inspection and selection.
- Initial dynamic rendering may skip atlas packing, static-style VAO compaction, and WebGL2
  instanced draws, but it should still use the shared visual-resource/cache path established by
  generated outdoor static instancing.
- Dynamic rendering should share static material support where the source/material facts are
  isomorphic.
- Dynamic rendering must support residence-aware submission so env-cell entities draw inside their
  cell/portal context and outdoor entities draw with the outdoor scene.
- Dynamic drawables submit under their owning entity's effective presentation residence. Per-part
  transforms and part-specific effects can affect draw calls and hit metadata, but they must not
  create independent source/effective residence records unless they represent separate dynamic
  entities.

### Dynamic Spatial Indexing

Worksheet coverage: dynamic spatial index shape, dynamic bounds, residence changes, no-residence
behavior, local-space storage, cross-anchor query transforms, and merged static/dynamic query API.

Requirement direction:

- Dynamic spatial indexing is separate from static BVH ownership.
- Dynamic spatial indices store landblock-local poses/bounds and derive scene-space query values only
  for the active anchor/query context. This follows the static draw-unit pattern and keeps
  reanchoring cheap.
- Dynamic spatial indices must index bounds derived from the current animation/hook state, not only
  the entity's base transform. Animated part-origin frames, `SetOmega`, scale transitions,
  replacement parts, and independently visible attachments are bounds-affecting.
- Source residence should not be recalculated solely because frontend animation, hook playback, or
  presentation motion moves visible geometry. Effective presentation residence and spatial index
  membership should be recalculated from current pose/bounds so culling, query, debug records, and
  renderer submission follow the visible entity without mutating source/authoritative residence.
- Env-cell membership can be a coarse dynamic index key for interior entities, but dynamic entities
  still need their own mutable bounds/hit data.
- Outdoor dynamic entities probably need a dynamic-friendly spatial query structure rather than
  piggybacking on static landblock BVHs.

### Static-Authored Dynamic Seeds

Worksheet coverage: first-target selection, static-seed evidence metadata, seed lifetime, static
scope eviction, static-seed/live-entity reconciliation, and authored dynamic classification.

Requirement direction:

- Do not classify suspicious static objects as dynamic without evidence.
- Do not hide marker-like or visually odd static objects by moving them into dynamic code as a
  workaround.
- Seed lifetime is tied to the owning static scope; resource and renderer lifetime are owned by the
  dynamic service and renderer respectively.
- Dynamic static entities are the expected first consumer, but they should not narrow the whole
  system away from spawned/live dynamic entities.

### Scene Query, Selection, And Diagnostics

Worksheet coverage: scene-query semantics, dynamic/static hit merging, semantic hit identity,
optional part/attachment/effect metadata, caller filters, diagnostics inventory, and temporary versus
durable diagnostics.

Requirement direction:

- Selection identity is semantic and stable across renderer resource churn.
- Diagnostics observe runtime/dynamic snapshots and renderer inspection data; they must not define
  core dynamic protocols.
- Dynamic scene query is a gameplay, selection, inspection, and diagnostics requirement. It must be a
  first-class frontend query path, not a debug-only renderer inspection feature.
- Scene query should become a merged surface that can return static, terrain, portal, and dynamic
  hits. Dynamic hits return semantic dynamic identity plus optional part/render details. Browser/client
  mode applies filters for selection, targeting, inspection, or debug behavior.

### Performance And Concurrency

Worksheet coverage: resource lifetime, update cadence, worker boundaries, asset-service sharing,
instancing value, and concurrency only where measured pressure requires it.

Requirement direction:

- Do not add a dedicated dynamic worker just because static has resolver/bake workers.
- Worker boundaries should follow measured IO/CPU pressure and clean ownership, not symmetry.
- Dynamic resources should share prepared asset/cache authority through the asset service.
- Skip dynamic atlasing, static-style VAO compaction, and WebGL2 instanced draws until requirements
  or profiling prove they are needed. Do not skip the shared-resource/per-instance submission split.

## First-Slice Requirements Gate

Status: satisfied by the 2026-06-26 dry run for the first static-authored default-animation slice.
Implementation phases may now be written for that slice, but the full live/spawned/script-bearing
dynamic system remains gated separately below.

Implementation phases for the first static-authored dynamic target required this gate to be
satisfied:

- A first dynamic target is selected with ACE/ACViewer/retail evidence.
- The target's source of authority is known and scoped to static-authored seed facts for the first
  slice.
- Static-authored dynamic seed identity, dynamic entity identity, renderer instance identity, and
  resource identity are defined.
- Static-authored seed lifetime is defined for static-scope entry, source update, scope eviction,
  resource failure, and renderer submission removal.
- Entity-level source and effective presentation residence are defined for the first target,
  including the rule that parts and animation-local transforms inherit the owning entity's effective
  presentation residence for render/query/index purposes.
- The minimum visual resource dependency graph is known for the first target: setup, part/gfx,
  material/texture resources, and animation frames.
- Unsupported dependency references are preserved and diagnosed. Unsupported render-affecting hooks
  warn and render as if the hook did not exist for the first slice; missing required asset
  dependencies still make the entity currently non-renderable without creating a durable failure
  record.
- The minimum motion/animation requirement is known for the first target, including what can be
  stubbed honestly and what cannot.
- The setup/animation/motion-table/script/script-table dependency set is classified for the first
  target, and motion tables, physics scripts, and script tables are either proven irrelevant or given
  an explicit defer policy.
- The first-slice hook dispatcher is defined: typed hook invocation shape, ownership/support routing,
  supported-handler dispatch, and unsupported-hook diagnostics. The first target does not need hook
  execution, but the dispatcher must be able to add `SetOmega` as the first handler.
- The first-slice frontend dynamic runtime shape is defined as a typed entity store plus explicit
  systems, with criteria for later component-map/index extraction.
- The first-target transform composition rule is defined for authoritative/base pose, animation
  position frames, per-part animation frames, and transform-adjacent hook effects such as scale and
  omega.
- The renderer dynamic commit contract is sketched enough to distinguish resource commits from
  instance commits without exposing caller-authored diffs as the public API.
- Dynamic renderer resource identity is compatible with the shared visual resource keys from
  `docs/plans/holtburger-3d-shared-render-instance-static-instancing-plan.md`, so duplicated dynamic
  parts can reuse GPU resources rather than creating per-entity VAOs/textures by default.
- Dynamic transform and bounds records are defined as landblock-local, with scene/render-local values
  treated as derived submission data.
- Dynamic spatial indexing ownership and API requirements are known for early dynamic rendering:
  existing outdoor landblock-grid traversal for candidate landblocks, per-landblock R-tree/RBush-style
  dynamic AABB indexes, effective-residence-keyed membership, update/removal, current-frame bounds,
  precision metadata, and merged static/dynamic query results.
- Effective frontend presentation residence is defined for the first slice: source residence is
  preserved for provenance/reconciliation, while effective residence drives renderer submission,
  spatial index membership, and scene query.
- Selection and diagnostics requirements are known for the first target.
- At least one validation strategy is defined for proving the first target without relying on
  runtime assets that cannot be checked into the repo.

### Dry Run Resolution

Recorded on 2026-06-26 after dry-running the first slice against current frontend, Tauri adapter,
content asset, renderer, and scene-query code.

First-slice answers:

- First target: confirmed. Use `0x020003e5` / animation `0x0300061b` as the first implementation
  target. It is a real static-authored outdoor dynamic target, has retail/user visual confirmation,
  needs setup default animation playback, and has no hooks, scripts, motion table, sound table, or
  script table.
- Immediate second target: confirmed. Use `0x020005ac` / animation `0x03000751` after the first
  target because it adds a frame-0 `SetOmega` hook and validates transform-side hook integration,
  current-frame bounds updates, and spatial index membership without introducing physics scripts.
- First-slice validation source policy: use real DAT/static-scene targets for end-to-end validation.
  Synthetic browser-mode entities are allowed only for focused unit/contract tests of renderer,
  resource, and query plumbing; they are not evidence for target selection or visual parity.
- Seed classification: confirmed for the first slice. A setup-backed static source with
  `defaultAnimation` becomes a static-authored dynamic seed instead of baked static geometry when the
  dynamic runtime supports its required dependencies. Do not use this rule to hide visually odd or
  marker-like static objects without authored dynamic evidence.
- Static-authored lifecycle: confirmed. The seed identity is source/scope-owned; the dynamic entity
  record is frontend-runtime-owned; renderer resource/instance identities are renderer-owned output.
  Static-scope eviction removes the seed, dynamic record, dynamic spatial index entries, and renderer
  submissions. Missing required resources make the entity currently non-renderable with loud
  diagnostics, not a baked static fallback.
- Hook policy: confirmed for first and second targets. The first target exercises the hook-generic
  dispatcher shape but has no hook execution. The second target should add typed `SetOmega` decoding
  and a supported transform-state handler; until that handler lands, rendering `0x020005ac` without
  omega is an explicit diagnosed visual compromise.
- Spatial/query strategy: confirmed. Reuse the existing outdoor landblock-grid traversal as the
  outer candidate phase. Add a per-landblock mutable 2D AABB hierarchy behind a small local wrapper,
  using a proven package added through the package manager during implementation rather than a
  bespoke tree or assumed version. Env-cell dynamic membership can stay flat for the first slice.
- Renderer contract: confirmed. Dynamic renderer work needs declarative resource and instance
  commits. It should generalize/reuse the visual-resource/cache and material-binding primitives from
  generated static instancing, but must not push dynamic entities through `setOutdoorDetailsLayer`,
  `StaticObjectRenderInstance`, baked static draw units, or layer-owned static lifetimes.
- Scene query: confirmed. Introduce a merged scene-query surface that can return static and dynamic
  hits ordered by distance. Keep browser/client selection as caller policy over query results.
  Static-authored scenery targets are debug/inspection-queryable but excluded by default browser
  selection filters because retail confirms they are not selectable.

First-slice bridge DTO inventory:

- Add an outdoor static-authored dynamic seed record variant. The current
  `StaticAuthoredDynamicSeedRecord` only represents env-cell static object seeds, so the outdoor
  windmill target cannot be modeled honestly until this union includes outdoor source facts.
- Static-authored dynamic seed facts must include source key/provenance, owning static work/scope,
  source residence, setup id, landblock-local base transform, static object identity, and the default
  animation id that triggered dynamic classification.
- Add a first-class `animation/0300....` content asset route and host asset key kind. The route should
  be wired through `ContentAssetRequest`, Tauri asset id parsing, Tauri JSON serialization, frontend
  zod contract validation, asset preparation routing, and `DynamicEntityResourceManager`.
- `AnimationAssetPayload` must preserve animation id, flags, part count, frame count, object
  position frames, per-part frames with origin/orientation, and typed hook summaries/invocations.
  Do not embed per-frame animation output in setup payloads and do not stream evaluated per-frame
  transforms over the bridge.
- First-slice dynamic resource readiness consumes setup, setup appearance or part/gfx/material/
  texture resources, and animation payloads through the existing asset service. Script, particle,
  sound, light, motion-table, and script-table payloads stay deferred unless a later target requires
  them.

Implementation plan implications:

- Start with DTO/contract plumbing before renderer work. Without outdoor dynamic seed records and an
  animation asset route, the selected target cannot enter the runtime honestly.
- Generalize renderer visual-resource ownership before adding dynamic instance submission. The
  existing reusable static-object visual resource cache is real, but today it is installed through
  outdoor-detail static layer replacement.
- Rename or wrap the current static picking API when introducing dynamic hits. A long-lived
  `pickStaticRay` plus a separate dynamic sibling would encode the wrong abstraction; the durable
  caller-facing shape is a scene query with static/dynamic hit variants.
- Add the mutable broadphase dependency during implementation with `npm` package-manager tooling so
  the latest compatible package/version is resolved by tooling, not assumed in this plan.

## Full Dynamic System Gate

These requirements remain open for later live/spawned/script-bearing dynamic targets. They should not
block the first static-authored default-animation slice:

- Dynamic lifetime rules for live interest entry, host update, parent/owner change, no-residence
  persistence, explicit destruction, and entity deletion.
- Spawned-object residence rules, including weak residence links and no-residence behavior.
- Browser/client-spawned ownership policy, including owner metadata, TTL/cancel semantics, and
  destruction authority.
- Entity-level residence rules for replacement visuals, part-anchored effects, and independently
  resident attachments/entities beyond the first target's inherited part transforms.
- Detailed equipment and attachment behavior for selectable wielded items, non-selectable appearance
  composition, parent frame updates, query identity, and selection filters.
- Live timeline trigger DTOs, including start timestamp, speed/intensity, sequence/cancel identity,
  and whether script-table resolution occurs before or after crossing the bridge.
- Host/frontend timeline drift policy for live timelines: asset ids, start times, speed/intensity,
  cancellation, hook ordering, and script-table resolution.
- Full hook ownership for gameplay/collision/visibility-affecting hooks such as `Attack`,
  `Ethereal`, `NoDraw`, `Scale`, `DefaultScript`, and `DefaultScriptPart`.
- Resource preparation and lifetime policy for supported scripts, particles, sounds, lights, script
  tables, and other non-first-target dependencies.
- Reconciliation beyond static-scope replacement/snap behavior, including live pose corrections,
  active timeline correction, script cancellation, no-draw, ethereal, scale, and host-authored
  timeline retiming.
- Specialized dynamic broadphase behavior beyond the first proven AABB index, env-cell dynamic
  indexing details, and performance optimizations once profiling or target complexity proves they are
  needed.

## Open Questions

First-slice open questions are resolved by the 2026-06-26 dry run and recorded in
`Dry Run Resolution` above:

- First evidence-backed target: `0x020003e5`, with `0x020005ac` as the `SetOmega` follow-up.
- Proposed first-slice answers: confirmed with DTO, renderer, query, and validation refinements.
- Hook ownership: confirmed for the hook-free first target and `SetOmega` follow-up; broader hook
  ownership remains under the full-system gate.
- Static-authored lifecycle: confirmed for static-scope entry, source update, scope eviction,
  resource failure, no-residence, and renderer submission removal.
- Bridge DTO inventory: first slice needs an outdoor dynamic seed record variant and a first-class
  animation asset route/payload.
- Spatial index/query strategy: first slice uses outdoor landblock-grid traversal plus a
  per-landblock mutable 2D AABB hierarchy behind a local wrapper; env-cell membership stays flat.
- Validation strategy: use real DAT/static-scene targets for end-to-end validation. Synthetic
  browser-mode entities are only test fixtures for focused renderer/resource/query contracts.

Full live/spawned bridge DTOs, browser/client spawn ownership, equipment/attachment orchestration,
and broad hook execution remain open for later targets under the Full Dynamic System Gate.

## Decisions So Far

- Dynamic rendering is not static landblock baking.
- Static-authored dynamic seeds are a requirements source, not the whole dynamic entity system.
- The dynamic service owns dynamic visual readiness and instance state.
- Runtime/world owns authoritative entity state and renderer-local placement policy.
- Renderer owns GPU realization and drawing only.
- Shared asset preparation remains governed by the asset service; dynamic workers must not create
  private durable prepared-asset registries.
- Dynamic static entities are the first expected consumer.
- Spawned dynamic entities are the main expected long-term consumer and require explicit destruction.
- Spawn intent belongs to host/runtime or browser/future client mode. The frontend runtime ingests
  explicit spawn/source facts and applies normalized dynamic lifecycle machinery, with source metadata
  preserving authority and ownership differences.
- Spawned dynamic residence links are weak and must not retain or induce scene interest.
- Dynamic source and effective presentation residence are per entity, not per rendered part.
- Parts, setup placements, replacement visuals, and part-anchored effects inherit their owning
  entity's effective presentation residence for render/query/index purposes unless promoted to
  independent dynamic entities by evidence.
- Attachments with independent identity, lifetime, authority, queryability, destruction, or movement
  semantics should be modeled as separate dynamic entities with their own source/effective residence
  rather than as per-part residence exceptions.
- Dynamic entities require first-class spatial query support for gameplay actions, selection,
  inspection, and diagnostics.
- Initial dynamic rendering can defer atlasing, VAO compaction, and WebGL2 instanced draws, but not
  the shared-resource/per-instance submission split.
- Dynamic entity transform and spatial records are landblock-local. Runtime/render submission derives
  scene-space placement from the effective presentation residence/anchor the same way static draw
  units do, so reanchoring remains cheap.
- Dynamic spatial indices follow the same local-space principle: store local bounds/poses and derive
  query-space values for the active scene/query context.
- Animated spatial envelopes do not redefine residence. Hooks such as `SetOmega` can require
  current-frame bounds/index updates while the entity remains resident in the same authoritative
  scope.
- Dynamic material support should reuse/generalize the existing static material interpretation rather
  than introduce a separate dynamic material pipeline.
- Instancing is an optimization requirement, not a first-slice architecture dependency.
- Animations are not stored exclusively in scripts.
- Setup, Animation, MotionTable, PhysicsScript, PhysicsScriptTable, and PlayScript are separate
  concepts in the dynamic entity model.
- Animation plus MotionTable is the primary authored animation path. PhysicsScript is the timed
  hook/effect path. PlayScript is a semantic cue that may resolve through a script table.
- Script-triggered render state must not be silently ignored. Unsupported script hooks should warn
  through diagnostics/console and render as if the hook did not exist until a supported handler is
  added.
- The first hook implementation should use a hook-generic imperative runtime/router. `SetOmega` is
  the first intended supported handler, not a reason to create a one-off hook path.
- DefaultScript and DefaultScriptPart chaining are real behavior and must be modeled or explicitly
  deferred when a target depends on them.
- Hooks are the shared command format used by both animation frames and physics scripts. Effects are
  the runtime consequences of hook execution, not a single standalone asset type.
- Physics scripts encode hook timing, not pose frames. Object translation comes from animation
  position frames, movement/kinematics, or authoritative object position updates.
- `CreateBlockingParticle` is presentation particle lifecycle, not physics blocking. Retail uses it
  as create-if-absent for an emitter id, while normal `CreateParticle` replaces an existing emitter
  with the same id.
- Script effects may be pure state mutations, timed transitions, asset-backed/table-backed effects,
  independent runtime objects, or script chaining. The dynamic system must classify supported hooks
  accordingly.
- Host/runtime and frontend runtime may both evaluate animation/script timelines, but only as
  projections of shared decoded data with explicit hook ownership policy.
- Host/runtime owns authoritative dynamic state, physics/collision-affecting outcomes, combat hooks,
  semantic visibility/targeting changes, live/semantic timeline trigger authority, and any durable
  entity state mutation.
- Static-authored setup default animations can start locally from static seed facts when retail
  evidence proves that behavior; host ownership of live timeline triggers does not imply host
  ownership of the frontend's presentation animation clock.
- Frontend runtime owns high-frequency presentation playback: animation pose evaluation, visual
  interpolation, render/audio/effect hooks, particles, material transitions, and presentation-only
  state derived from host-authorized timeline starts or retail-proven static setup defaults.
- For live/spawned entities, the bridge should carry timeline trigger facts and authoritative state
  deltas, not per-frame animation transforms or frontend-only per-hook presentation events.
- Frontend hook execution must never create authoritative truth. Any hook that affects gameplay,
  collision, targeting/action validity, or durable world state is host-owned or both-projected, not
  frontend-only.
- The first-slice frontend runtime should be hybrid and typed, not a full ECS: start with a
  `DynamicEntityStore`, explicit ECS-like record passes where useful, and imperative modules where
  async/resource, hook-routing, diagnostics, renderer commits, or placement/bounds/index coupling
  make that cleaner. ECS-like data stays on nested `DynamicEntityRecord` sub-objects for the first
  slice; extract component maps/indexes only when real iteration pressure or proven requirements
  justify it.
- Dynamic renderer handles are not source-of-truth components. Renderer state is derived output from
  semantic dynamic runtime state.
- Animation playback is an ECS-like record pass. Runtime transform integration can become a separate
  ECS-like pass once velocity, acceleration, omega, scale-style modifiers, or other supported
  object-frame transform effects require it; the first target can keep base pose plus animation
  output flowing into `DynamicPlacementTracker`.
- Frontend dynamic transform integration is presentation/runtime projection, not authoritative world
  physics. Host/runtime state owns durable position, residence, collision, and gameplay corrections.
