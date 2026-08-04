# Holtburger 3D Runtime Light System Plan

Status: Draft — not yet executing.
Created: 2026-08-04

## Goal

Build one runtime point-light system with pluggable producers, and use it to light the outdoor
world with its authored lamps and braziers.

## Scope

**In scope**

- Two light sets with different update cadences — static per landblock, dynamic per frame — sharing
  one shader evaluation. The dynamic set applies to every draw; the static set is outdoor-only,
  because interior statics are already baked.
- Shader evaluation generalized from the existing single-light viewer headlamp to bounded arrays.
- Outdoor authored static lights as the first bulk producer, reaching terrain, buildings,
  explicit objects, and instanced generated scenery alike.
- The viewer headlamp migrated into the dynamic set rather than remaining a bespoke uniform.

**Out of scope**

- **Interior static lighting stays baked.** This is a deliberate retention, not an oversight; the
  rationale is recorded under Design Rules below.
- Entity-carried lights and the `SetLight` animation hook. This plan builds the system and the
  selection they need; only the _producer_ remains blocked on
  [holtburger-3d-dynamic-entity-runtime-plan.md](holtburger-3d-dynamic-entity-runtime-plan.md).
- Timed `SetLuminosity`/`SetDiffusion`, spell environment overrides, and the sky pass — all
  unchanged from [holtburger-3d-scene-lighting-plan.md](holtburger-3d-scene-lighting-plan.md).
- Shadows. Retail has none and nothing here implies them.

## Ground Truth

### Retail already has one runtime light path

Retail does not distinguish static from dynamic lights at evaluation time. `LightParms
Render::world_lights` (`acclient.h:19084`) holds `static_lights[60]` and `dynamic_lights[10]` side
by side, both as `RenderLight`/`LIGHTINFO`. Both are distance-sorted into their arrays by the same
`Render::insert_light` (`acclient.c:364013`), which computes `distancesq` from
`Render::player_pos`, insertion-sorts nearest-first, and drops a light that is farther than every
slot when the array is full. Both are programmed by the same
`PrimD3DRender::config_hardware_light` (`acclient.c:432829`) into the same eight hardware slots.
`Render::minimize_object_lighting` (`acclient.c:364212`) simply fills those slots with dynamic
lights first and static ones after.

Static versus dynamic is therefore a **lifetime** distinction in retail rather than a difference in
how a light is evaluated. That does not make it free of design consequence: lifetime is exactly
what sets update cadence, which is why retail still keeps the two in separate arrays and why we do
too (Design Rule 4). The only place their _evaluation_ diverges is that EnvCell meshes can have
static light burned into vertex colors as an optimization (`acclient.c:434570`).

Relevant caps: `max_static_lights = 40`, `max_dynamic_lights = 7`, both scaled by the detail
slider in `Render::SetDegradeLevelInternal` (`acclient.c:44527`, `363340`); eight hardware slots
(`acclient.c:437231`); attenuation `Att0/1/2 = 0/1/0`, i.e. pure `1/d`, with
`Range = falloff * 1.5` (`acclient.c:432899`, `44671`). We keep retail's range but not its `1/d`
attenuation — see Design Rule 3 for why authored magnitudes make it unusable.

Full model and constants: [docs/lighting.md](../lighting.md).

### Measured outdoor content

Censused over the whole retail archive (`crates/holtburger-debug-harness/src/bin/outdoor_light_census.rs`):

| Record                      | Placements                 | Authored lights                                    |
| --------------------------- | -------------------------- | -------------------------------------------------- |
| Explicit outdoor objects    | 42,942 (30,159 Setup refs) | **2,257**, from 75 distinct setups                 |
| Buildings                   | 6,979, **all GfxObj**      | 0 — structurally impossible, lights live on Setups |
| Generated scenery templates | 1,167 (975 Setup refs)     | **0** across all 179 scenes                        |

629 of 5,346 landblocks contain any outdoor light, averaging ~3.6 each; the archive maximum is 51
in one landblock. The most-placed emitter, setup `0x020005D8`, appears 451 times.

Their authored magnitudes matter as much as their count: **intensity is 100 at the median** (min 20,
p90 100) and **falloff is 6 at the median** (p90 7, max 15), so a typical lamp reaches
`6 * 1.5 = 9` units. Authored lights are therefore on a completely different intensity scale from
retail's viewer light, which is authored at `0.5 * 4.5 = 2.25`. Design Rule 3 depends on this.

**Every outdoor light comes from the Objects layer. Everything else is purely a receiver.**

### Existing patterns and touch points

- `apps/holtburger-3d/src/lib/game/renderer/webgl2-lighting.ts` — shared GLSL. `evaluateViewerLight`
  is currently retail's hardware point light (`1/d`, hard range cutoff) for exactly one light.
  Generalizing it to an array _and_ swapping its falloff for the burn-in shape is the core shader
  change.
- `apps/holtburger-3d/src/lib/game/environment/scene-lighting.ts` — `SceneLightingByRole` and
  `resolveSceneLightingByRole`, where per-frame lighting is derived once. The headlamp already
  enters here as a renderer-supplied value.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts` — `SceneShading` threading,
  `#applyObjectLighting` per-draw binding with `applyLightingRole` dedupe, and
  `anchorRelativePosition` for the anchor-relative space every light position must use.
- Every draw already resolves its landblock: terrain through `drawUnit.coordinates`, objects
  through `placement.landblockId` (`webgl2-renderer.ts:1311`). Per-landblock binding needs no new
  identity plumbing.
- `apps/holtburger-3d/src/lib/game/resolution/presentation.ts` — `ResolvedObjectLight` and
  `PlacedStaticLight` already exist and are already decoded for every setup, outdoor included.
- `apps/holtburger-3d/src/lib/game/commit/interior-static-lighting.ts` — `placeObjectLights`
  already composes authored lights with a placement into landblock space, and is reusable as-is.

## Design Rules

These are the decisions this plan is built on. They are recorded here so later work does not
relitigate them by accident.

1. **Bake when the geometry and the lights reaching it resolve together at materialization;
   evaluate otherwise.** This, not retail imitation, is the organizing rule.
   - Interiors satisfy it: a landblock's cells, their residents, and their lights all materialize
     as one unit. Baking gives each cell an exact light set with no cap and no camera-driven
     selection error — which matters precisely for cells seen through long portal chains, where
     nearest-to-camera selection is worst — and costs zero per-vertex work for the densest
     geometry in view.
   - Outdoors does not satisfy it: emitters live in the Objects layer while receivers live in
     Terrain, Buildings, and Generated. These are not merely streamed independently — they carry
     **independent interest radii** (`buildingRadius`, `explicitObjectRadius`,
     `generatedObjectRadius`, resolved per landblock in `scene-interest.ts`), so a landblock can
     hold buildings while its Objects layer is _never resident at all_. A bake there is not a
     late-arrival race that eventually settles; it is permanently and unfixably dark. Terrain
     additionally exists as several LOD, stride, and transition variants, and generated scenery is
     instanced.
2. **Retail parity is a guide, not a contract.** Where retail's structure is the natural fit we
   follow it; where our architecture suggests otherwise we diverge deliberately and record why.
3. **Authored lights use retail's burn-in falloff, whether baked or evaluated.** Plain hardware
   `1/d` cannot carry authored magnitudes: at the median intensity of 100 and falloff of 6, the
   term is 20 at five units and still 11 at the nine-unit edge, so a lamp saturates to full colour
   across its whole range and then stops dead — a hard-edged disc, not a pool. The burn-in shape
   (`calc_point_light`'s half-Lambert wrap, the `(1 - d/range)` taper, and the per-channel clamp to
   the light's own colour) saturates the same core but falls smoothly to zero at the boundary, and
   it degrades correctly for small intensities too. So the falloff shape follows the light's
   **authorship**, not whether it is baked or evaluated. The viewer light, authored by us at 2.25,
   runs through the same function and simply never reaches the clamp.
4. **Producers share evaluation, not storage or cadence.** Static and dynamic lights differ in
   lifetime, and lifetime determines how often the set changes, which determines how it is stored
   and bound. Forcing both through one array would collapse the static path's residency cache into
   a per-frame rebuild the moment a lit entity moves. So:
   - **Static lights are scoped per landblock**, cached against content residency, and never
     rebuilt per frame. They run through the same selection routine as dynamics, but a generous cap
     means it is expected to be a pass-through in practice.
   - **Dynamic lights are one small global set**, rebuilt each frame, camera-selected nearest-first,
     and bound once per frame rather than per landblock. A light straddling a landblock boundary is
     then not a special case, because every draw sees the whole dynamic array.
   - The shader loops over both. This is also why retail keeps `static_lights[60]` and
     `dynamic_lights[10]` as separate arrays: not a hardware artifact, the same cadence argument.
5. **Adding a producer must not change selection, binding, or shader code.** Entity lights should
   land as data feeding the dynamic set, nothing more.
6. **Lights are selected by distance, never by screen visibility.** A light behind the camera still
   illuminates what is in front of it, and a light just outside the frame lights geometry inside
   it, so frustum-culling lights makes objects pop dark as the camera turns. Retail agrees:
   `insert_light` (`acclient.c:364013`) ranks by `distancesq` from the player position and applies
   no visibility test at all.
7. **Dynamic lights apply outdoors, deviating from retail deliberately.** Retail's outdoor pass
   binds only the sun (`useSunlightSet(1)`, `acclient.c:441094`), so dynamic lights never reach
   outdoor geometry there, and its viewer light is invisible outdoors. Whether that was a design
   choice or a consequence of budgeting eight hardware slots is not something the decompile
   answers, and it does not change our decision either way: the restriction stops making sense once
   we light the outdoors with static lamps, since a torch-carrying creature walking between lit
   lamp posts would cast nothing. The viewer light is **gameplay lighting outdoors**, not an
   explorer-only affordance. Applying the dynamic set to every draw is also strictly less code than
   gating it by role. The cost is that outdoor draws iterate the dynamic array; an empty set
   early-outs on a count check, so North Star 4 still holds whenever nothing dynamic is lit.

## Spatial Scope

**The landblock grid is our spatial index, and we add nothing on top of it.** Content residency
already partitions the world, so static light gathering is "iterate this landblock's Objects-layer
residents", and neighbour spill is a fixed nine-landblock fan-out performed once per residency
change. There is no tree, no light grid, and no spatial query anywhere in the static path. This is
recorded explicitly because its absence looks like an oversight otherwise: the acceleration
structure exists, we just inherited it from content residency instead of building one.

**The cost of that choice is coarseness.** A landblock is 192 units, while a light reaches
`falloff * 1.5` — about 22.5 units at the maximum authored falloff of 15 observed in the indoor
census. A landblock's set therefore contains lights that cannot reach most of its geometry, and the
shader iterates all of them per vertex regardless. At the measured average of 3.6 lights per lit landblock this is irrelevant. At
the archive's worst landblock of 51, a vertex genuinely reached by one or two lights still
iterates 51, roughly 25x wasted iteration.

**The escalation, if Phase 3 shows that matters, is culling the landblock set against each draw
unit's bounds at bind time** — an AABB-versus-sphere test per light, reusing bounds already carried
for footprint culling. It decouples gathering from binding: gathering and its residency cache stay
per landblock, while binding tightens to per draw unit. That is a trade rather than a free win,
because it pushes bind granularity down and feeds the bind-frequency risk below. Do not build it
speculatively.

**Clustered or tiled forward rendering is explicitly out of scope, and here is the threshold.**
That technique earns its complexity at hundreds of lights per view. Our hard content ceiling is 51
in the worst landblock in the entire archive, with single digits typical. Reaching for it should
require arguing against that number.

**Dynamic lights need no index at all.** The set is small by construction and selection is a linear
pass over active producers. An index there would be guarding against a content problem rather than
a performance one.

## North Stars

1. One evaluation path for every runtime light. A second bespoke light uniform is a design
   failure.
2. The system is defined by its producers, not by its first caller. Outdoor statics are one
   producer that happens to land first.
3. Per-frame work scales with what moves, not with what exists. Static lights are gathered once
   per residency change; a frame that moves no light should re-upload nothing.
4. Cost scales with what is lit, not with what exists. A landblock with no lamps binds an empty
   static set and runs no static iteration, and uploads are sized to the actual light count rather
   than the cap. The dynamic set is a separate matter: with the viewer light on by default it is
   rarely empty, so every draw should expect at least one dynamic iteration.
5. Dropping lights is normal operation, not an error. A budget overflow is a resource limit doing
   its job, exactly as retail's `insert_light` discards anything farther than every occupied slot.
   Selection is what makes it graceful: without it a cap drops whatever was gathered last, which
   could kill the nearest lamp. Report drops in a metric so they are observable; never assert on
   them.
6. Anything compared against a vertex position lives in anchor-relative space. This has already
   caused one invisible-light bug.

## Phased Implementation

### Phase 1: Dynamic light set and shader array

Build the mechanism and prove it by migrating something that already works, so this phase changes
no pixels. The dynamic path comes first because it is the one that genuinely needs selection, and
because the headlamp already exercises it end to end.

Deliverables:

- A `DynamicLightSet` contract: a small bounded array of runtime point lights in anchor-relative
  space, rebuilt each frame from dynamic producers and bound **once per frame**.
- One selection routine, shared by both light sets, mirroring `Render::insert_light`'s policy —
  rank by squared distance from the camera, keep the nearest, drop the rest — with a frame metric
  counting drops. Distance only; no frustum test, per Design Rule 6. Phase 2's static set calls
  this same function; there is no separate static selection.
- The dynamic set applies to every draw role, indoor and outdoor, per Design Rule 7. The headlamp
  therefore becomes visible outdoors, where it previously was not.
- Shared GLSL: generalize `evaluateViewerLight` into a loop over the bound array, replacing its
  plain `1/d` with the burn-in falloff per Design Rule 3 — the viewer light's appearance is
  unchanged at intensity 2.25, but authored lights then behave correctly too. This is the one place
  Phase 1 is not purely mechanical, so it carries its own before/after check. Uploads are sized to
  the live count, never to the cap.
- A single point-light function shared by the CPU baker and the shader, so the interior bake and
  the runtime path cannot drift.
- The viewer headlamp stops being a bespoke uniform pair and becomes simply the first entry in the
  dynamic set.

Acceptance criteria:

- Interiors render identically to before: the headlamp is the only dynamic producer, and swapping
  it onto the burn-in falloff is visually indistinguishable at its authored intensity of 2.25.
  Verify with a before/after capture rather than by assertion.
- Outdoors, the headlamp now lights nearby ground and objects at night and is invisible at midday,
  where sun and ambient already saturate.
- Unit tests cover selection: ordering, cap behaviour, drop counting, and the empty case. Overflow
  is asserted to drop the farthest light and retain the nearest, since that is the property making
  a cap safe.
- The shader uniform/varying consistency test covers the new array declarations.
- A frame with no dynamic lights uploads nothing and takes no per-light branch.

Tasks:

- [x] `DynamicLightSet` type and per-frame assembly.
- [x] Nearest-first bounded selection with a drop metric.
- [x] Shader array evaluation replacing the single-light path.
- [x] Migrate the headlamp into the dynamic set; delete the bespoke uniforms.

Progress: Complete (2026-08-04). `npm run check` by exit code, 618 frontend tests, GLSL
validation, lint, and a browser-harness render are green.

Decisions and course corrections:

- **Concession: the acceptance criterion claiming the headlamp would be visually
  indistinguishable was wrong, and the viewer light was retuned.** The authored falloff is
  effectively inverse-square while retail's hardware path is inverse-linear, so at retail's
  authored intensity of 2.25 the headlamp came out roughly thirty times dimmer at ten units and
  useless past two — measured, not estimated. Since the falloff shape is our choice, its intensity
  is ours to calibrate: `VIEWER_LIGHT.intensity` is now 34, derived to reproduce retail's
  contribution at the midpoint of the light's range, giving a saturated core to about five units
  tapering to nothing at fifteen. A test pins that derivation so the value cannot drift silently.
- **Constants cross the language boundary; structure does not.** `point-light-falloff.ts` owns the
  wrap constants and exports both the TypeScript implementation and a GLSL mirror that interpolates
  those same constants, so the baker and the shader cannot disagree on a number. The duplicated
  control flow is covered by a test asserting the mirror keeps the same early-outs.
- **Selection passes through untouched when under budget**, so the common case pays no sort. Tests
  assert the overflow case drops the farthest and retains the nearest, which is the property that
  makes a cap safe rather than arbitrary.
- **`viewerLight` left `ResolvedSceneLighting` entirely.** Dynamic lights are frame-global rather
  than per-role, so they live on `SceneShading` and bind alongside the role-derived sun and ambient.
  `resolveSceneLightingByRole` lost a parameter as a result.
- **Tooling**: the terrain GLSL validator now resolves nested `${...}` interpolations and numeric
  constants from TypeScript modules, since the shared lighting block interpolates both a GLSL
  module and a cap. It fails loudly on an unknown name so a renamed export cannot leave a literal
  placeholder in validated source.
- Debt: the headlamp retune is verified numerically and by test, but the capture that demonstrates
  it is inconclusive — the geometry near enough to photograph saturates at either intensity, and
  the difference lives at seven to fifteen units. Worth a better framing when interior verification
  is unblocked.

### Phase 2: Outdoor static light producer

Deliverables:

- A per-landblock static light array, bound alongside the dynamic set, capped at 64 and run through
  the Phase 1 selection routine. The cap needs no census: 51 is the largest set any single
  landblock owns in the archive, neighbour spill is bounded by a roughly 22.5-unit band on a
  192-unit edge, and overflow degrades gracefully by dropping the farthest light. Gathering uses
  the maximum authored falloff rather than a measured distribution, since over-gathering is free —
  the shader's range check culls anyway.
- Gather authored lights from the Objects layer per landblock, composing each with its resident
  placement through the existing `placeObjectLights`. Cache per landblock; the set changes only
  with content residency, never per frame.
- Include neighbouring landblocks' lights whose reach crosses the boundary.
- Bind the resulting set for every outdoor draw of that landblock — terrain, buildings, objects,
  and instanced generated scenery. This extends the existing lighting-role dedupe rather than
  reusing it unchanged: the key becomes role plus landblock, since two draws sharing a role may
  need different static sets.
- The static set must not apply to interior draws, whose static lighting is already baked. The
  dynamic set still does, per Design Rule 7.

Acceptance criteria:

- At night in a lit town landblock (`0xDA55` has 39 lights), lamps visibly illuminate the ground,
  nearby buildings, and nearby scenery, and the illumination moves correctly as the camera does.
- An unlit landblock binds an empty set and shows no measurable per-frame cost.
- Interiors are visually unchanged.
- A landblock whose Objects layer arrives after its Buildings layer ends up correctly lit, proving
  the streaming-order problem that motivated evaluation over baking is actually solved.
- A static-light bind metric shows binds tracking visible lit landblocks rather than draw-call
  count, confirming draw order is landblock-coherent enough for per-landblock binding.

Tasks:

- [x] Per-landblock outdoor light gathering with residency-scoped caching.
- [x] Neighbour spill inclusion.
- [x] Per-landblock binding across all four outdoor receivers, with a bind-frequency metric.
- [x] Browser verification at night, including the late-arriving-layer case.
- [x] Terrain point lights moved to the fragment stage.

Progress: Complete (2026-08-04). Lamps light objects, buildings, and the ground at night, with
visible pools on terrain.

Decisions and course corrections:

- **Terrain point lights moved to the fragment stage, because terrain is too coarse for
  per-vertex evaluation.** A landblock's terrain is 9x9 vertices over 192 units, so vertices sit
  **24 units apart**, while the lamps actually placed in a town reach only 4.5 to 7.5 units. A lamp
  therefore touches at most one terrain vertex and usually none; when it does touch one, the result
  is a 24-unit gradient smeared across the quad rather than a pool. Sun and ambient stay per vertex
  because they are directional and interpolate correctly across any triangle; only the point-light
  loop is per pixel. Objects deliberately keep per-vertex evaluation, because their meshes are
  finely tessellated and do not have this problem. Verified: pools are clearly visible on the
  ground beside lit buildings at night.
- **Authored lamps are much shorter-range than the archive-wide median suggested.** The lamps in
  the verification landblock have falloffs of 3 to 5, so they reach 4.5 to 7.5 units, and their
  light offsets are effectively zero — the emitter sits at the object's own origin, at ground
  level. Pools are consequently small and tight rather than broad.
- **Lights are gathered at artifact assembly, not in the worker.** `assembleStaticObjectArtifact`
  composes each resident's authored lights with its placement using the existing
  `placeObjectLights`, so the set is resolved once per residency change. The landblock comes from
  the layer owner id, which already encodes it, so no new plumbing crossed the commit boundary.
- **`OutdoorLightIndex` owns neighbour spill and memoization.** It keys owned lights by landblock,
  resolves an effective set by testing each neighbour light's sphere against the target landblock's
  horizontal extent, and clears memoized sets wholesale on any residency change — since one
  landblock's lights can reach eight others, and residency changes are rare relative to frames. A
  test covers the late-arriving-neighbour case that would otherwise be masked by a memoized empty
  result.
- **Static binds are keyed by landblock, not role.** Two draws sharing a role can sit in different
  landblocks, so `applyStaticLightScope` extends the existing dedupe. Interior draws bind an empty
  set, since their static lighting is baked. Measured on a lit town neighbourhood: 13 static binds
  per frame, tracking visible landblocks rather than draw-call count, so per-landblock binding
  holds and the uniform-buffer escalation is not needed.
- Concession: vertical extent is ignored when testing whether a neighbour's light reaches a
  landblock. Terrain height is unbounded in the index, and a light that is horizontally in range
  but vertically distant is culled by the shader's range check anyway, so the only cost is a
  slightly larger candidate set.

### Phase 3: Resteer

- Re-measure frame cost with lights active in a dense town, and confirm the cost north stars hold
  for unlit landblocks and for frames where nothing moves.
- Read the static bind-frequency metric. If binds track draw calls rather than landblocks, decide
  between sorting draws by landblock and escalating to a uniform buffer (see Risks).
- Decide whether the per-vertex loop cost in a dense landblock justifies draw-unit bounds culling,
  weighing it against the bind-frequency cost that culling introduces (see Spatial Scope).
- Confirm the producer interface is genuinely additive by sketching, without building, how entity
  lights attach to the dynamic set. If it needs changes, make them now while the only dynamic
  producer is the headlamp.
- Review accumulated debt and fold corrections into the remaining phases.

### Phase 4: Cleanup and wrap-up

- Update [docs/lighting.md](../lighting.md) with the runtime system, the bake-versus-evaluate rule,
  and the outdoor census.
- Record the entity-light attachment point for the dynamic-entity runtime plan.
- Remove or deliberately promote the outdoor light census harness, whose findings are recorded in
  this plan's Ground Truth.
- Sweep vocabulary: nothing should describe the headlamp as a special case once it is a producer.

## Risks & Mitigations

- **Bind frequency, not gather cost, is the CPU risk.** Gathering is residency-cached, so the
  per-frame work is binding. `view.objects` is populated in scene-traversal order and is not sorted
  by landblock, so interleaved landblocks would make static binds scale with draw-call count
  instead of visible-landblock count. Mitigation: measure it in Phase 2 with a dedicated metric
  before optimizing. Escalation path, in order: sort draws by landblock where it does not fight
  material batching, then move the static sets into a uniform buffer and bind with
  `bindBufferRange`, which turns a bind into a pointer change with no upload — cheap to reach for
  because the data is immutable per landblock.
- **Per-vertex loop cost.** A light loop runs per vertex on every receiver, over the whole
  landblock set rather than the lights that actually reach the vertex — see Spatial Scope for the
  coarseness figure and the draw-unit culling escalation. Terrain is _not_ the
  worry: a landblock is 9x9 = 81 vertices, so fifty resident landblocks total roughly 4,000
  vertices, less than one building. Buildings and objects carry the vertex count. Mitigation:
  unlit landblocks bind an empty static set and run no static iteration, though the dynamic loop
  still runs while the viewer light is on; the Phase 3 resteer measures a dense town.
- **Selection error at range.** Nearest-to-camera selection can pick the wrong lights for distant
  geometry. Mitigation: this is why interiors stay baked, and why static lights are scoped per
  landblock rather than pooled globally — a distant lamp cannot be culled by nearer ones, because
  it is only ever selected against its own landblock. Only the dynamic set, which is small, uses
  camera-relative selection.
- **Anchor-space mistakes.** Light positions compared against vertex positions must be
  anchor-relative; this has already produced one invisible light. Mitigation: `anchorRelativePosition`
  is the single owner of that conversion and every producer routes through it.
- **Cache invalidation on residency changes.** A cached per-landblock set must be rebuilt when the
  Objects layer arrives, changes, or is withdrawn. Mitigation: key the cache by the same interest
  revision the layer artifacts already use, so a stale set cannot outlive its source.

## Definition of Done

- [ ] One shader path evaluates every runtime light; no bespoke single-light uniforms remain.
- [ ] Bind frequency is measured, and its cost is either accepted or mitigated by a recorded
      decision — not left unexamined. A deliberate move to draw-unit culling raises bind counts on
      purpose, so the gate is the decision, not a particular number.
- [ ] Outdoor lamps illuminate terrain, buildings, objects, and generated scenery at night.
- [ ] Interiors are visually unchanged and still baked.
- [ ] Caps documented with their reasoning, and drops observable in a frame metric rather than
      asserted.
- [ ] `npm run check` (by exit code), frontend tests, GLSL validation, lint, formatting, and
      `cargo clippy` all clean.
- [ ] Browser-harness verification at night in a lit landblock, including the late-arriving-layer
      case.
- [ ] `docs/lighting.md` updated; entity-light attachment point recorded.

## Open Questions

- Does the detail slider eventually scale the caps, as retail's degrade level does? Not needed now,
  but the dynamic selection layer is where it would live.
- Should interior draws also receive the per-landblock static set for lights authored _outside_
  the cell, or is the bake plus the dynamic set sufficient? Retail's cell pass takes only dynamics
  alongside the burn-in, which suggests sufficient.
- Do outdoor lights belong to a landblock or to a scene scope once portal-visible outdoor cells
  are considered? Phase 2 assumes landblock; the resteer should confirm nothing about portal views
  contradicts that.
