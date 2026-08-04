# Holtburger 3D Runtime Light System Plan

Status: Draft — not yet executing.
Created: 2026-08-04

## Goal

Build one runtime point-light system with pluggable producers, and use it to light the outdoor
world with its authored lamps and braziers.

## Scope

**In scope**

- Two light sets with different update cadences — static per landblock, dynamic per frame — sharing
  one shader evaluation, both applying to indoor and outdoor draws alike.
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

Static versus dynamic is therefore a **lifetime** distinction in retail, not a lighting one. The
only place the two genuinely diverge is that EnvCell meshes can have static light burned into
vertex colors as an optimization (`acclient.c:434570`).

Relevant caps: `max_static_lights = 40`, `max_dynamic_lights = 7`, both scaled by the detail
slider in `Render::SetDegradeLevelInternal` (`acclient.c:44527`, `363340`); eight hardware slots
(`acclient.c:437231`); attenuation `Att0/1/2 = 0/1/0`, i.e. pure `1/d`, with
`Range = falloff * 1.5` (`acclient.c:432899`, `44671`).

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

**Every outdoor light comes from the Objects layer. Everything else is purely a receiver.**

### Existing patterns and touch points

- `apps/holtburger-3d/src/lib/game/renderer/webgl2-lighting.ts` — shared GLSL. `evaluateViewerLight`
  is already retail's hardware point light (`1/d`, hard range cutoff) for exactly one light;
  generalizing it to an array is the core shader change.
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
     Terrain, Buildings, and Generated, all streaming independently. Anything frozen at
     materialization is wrong by construction, since a building realized before the Objects layer
     arrives would bake dark permanently. Terrain additionally exists as several LOD, stride, and
     transition variants, and generated scenery is instanced.
2. **Retail parity is a guide, not a contract.** Where retail's structure is the natural fit we
   follow it; where our architecture suggests otherwise we diverge deliberately and record why.
3. **Two falloff shapes coexist, and that is fine.** Baked interior light uses retail's
   half-Lambert wrap; runtime lights use hardware `1/d`. No surface is lit twice by the same light
   through both paths, so this is an aesthetic difference, not a divergence risk. Retail does
   exactly the same thing, and an interior surface already receives both — its baked torchlight
   plus the evaluated headlamp.
4. **Producers share evaluation, not storage or cadence.** Static and dynamic lights differ in
   lifetime, and lifetime determines how often the set changes, which determines how it is stored
   and bound. Forcing both through one array would collapse the static path's residency cache into
   a per-frame rebuild the moment a lit entity moves. So:
   - **Static lights are scoped per landblock**, cached against content residency, and never
     rebuilt per frame. No selection is required, because the cap exceeds any single landblock's
     set.
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

## North Stars

1. One evaluation path for every runtime light. A second bespoke light uniform is a design
   failure.
2. The system is defined by its producers, not by its first caller. Outdoor statics are one
   producer that happens to land first.
3. Per-frame work scales with what moves, not with what exists. Static lights are gathered once
   per residency change; a frame that moves no light should re-upload nothing.
4. Cost scales with what is lit, not with what exists. A landblock with no lamps should pay
   nothing, and uploads are sized to the actual light count rather than the cap.
5. Selection is explicit and observable. When lights are dropped, say so in a metric rather than
   silently dimming the world.
6. Anything compared against a vertex position lives in anchor-relative space. This has already
   caused one invisible-light bug.

## Phased Implementation

### Phase 0: Evidence

The archive maximum of 51 lights in one landblock is for a landblock in isolation. Lights near a
boundary reach into the neighbour, so the number that sizes the static array is the worst case
_reaching_ set.

Deliverables:

- Extend the outdoor census to compute, for every landblock, the set of lights whose authored
  reach (`falloff * rangeAdjust`) intersects that landblock's bounds, including lights owned by
  the eight neighbours. Report the distribution and the maximum.
- Report how many landblocks exceed candidate caps (16, 32, 64) so the static cap is chosen from
  data.
- Confirm the authored falloff distribution outdoors matches the indoor census (1–15), since the
  reach calculation depends on it.

Acceptance criteria:

- A static cap is chosen with the number of affected landblocks stated, or overflow is shown to be
  impossible. If no landblock can overflow, the static path ships without selection at all.

Tasks:

- [ ] Neighbour-inclusive reaching-set census.
- [ ] Static cap decision recorded here with its evidence.

Decisions and course corrections: _(fill during execution)_

### Phase 1: Dynamic light set and shader array

Build the mechanism and prove it by migrating something that already works, so this phase changes
no pixels. The dynamic path comes first because it is the one that genuinely needs selection, and
because the headlamp already exercises it end to end.

Deliverables:

- A `DynamicLightSet` contract: a small bounded array of runtime point lights in anchor-relative
  space, rebuilt each frame from dynamic producers and bound **once per frame**.
- Nearest-first selection with an explicit cap, mirroring `Render::insert_light`'s policy — rank by
  squared distance from the camera, keep the nearest, drop the rest — and a frame metric counting
  drops. Distance only; no frustum test, per Design Rule 6.
- The dynamic set applies to every draw role, indoor and outdoor, per Design Rule 7. The headlamp
  therefore becomes visible outdoors, where it previously was not.
- Shared GLSL: generalize `evaluateViewerLight` into a loop over the bound array, preserving its
  per-light math exactly. Uploads are sized to the live count, never to the cap.
- The viewer headlamp stops being a bespoke uniform pair and becomes simply the first entry in the
  dynamic set.

Acceptance criteria:

- Interiors render identically to before: the headlamp is the only dynamic producer and its math is
  unchanged.
- Outdoors, the headlamp now lights nearby ground and objects at night and is invisible at midday,
  where sun and ambient already saturate.
- Unit tests cover selection: ordering, cap behaviour, drop counting, and the empty case.
- The shader uniform/varying consistency test covers the new array declarations.
- A frame with no dynamic lights uploads nothing and takes no per-light branch.

Tasks:

- [ ] `DynamicLightSet` type and per-frame assembly.
- [ ] Nearest-first bounded selection with a drop metric.
- [ ] Shader array evaluation replacing the single-light path.
- [ ] Migrate the headlamp into the dynamic set; delete the bespoke uniforms.

Decisions and course corrections: _(fill during execution)_

### Phase 2: Outdoor static light producer

Deliverables:

- A per-landblock static light array, bound alongside the dynamic set, with its own cap from
  Phase 0. Selection is omitted unless Phase 0 proved overflow is possible.
- Gather authored lights from the Objects layer per landblock, composing each with its resident
  placement through the existing `placeObjectLights`. Cache per landblock; the set changes only
  with content residency, never per frame.
- Include neighbouring landblocks' lights whose reach crosses the boundary, per the Phase 0
  finding.
- Bind the resulting set for every outdoor draw of that landblock — terrain, buildings, objects,
  and instanced generated scenery — reusing the existing per-draw lighting-role dedupe.
- Lights must not apply to interior draws, whose static lighting is already baked.

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

- [ ] Per-landblock outdoor light gathering with residency-scoped caching.
- [ ] Neighbour spill inclusion.
- [ ] Per-landblock binding across all four outdoor receivers, with a bind-frequency metric.
- [ ] Browser verification at night, including the late-arriving-layer case.

Decisions and course corrections: _(fill during execution)_

### Phase 3: Resteer

- Re-measure frame cost with lights active in a dense town, and confirm the cost north stars hold
  for unlit landblocks and for frames where nothing moves.
- Read the static bind-frequency metric. If binds track draw calls rather than landblocks, decide
  between sorting draws by landblock and escalating to a uniform buffer (see Risks).
- Confirm the producer interface is genuinely additive by sketching, without building, how entity
  lights attach to the dynamic set. If it needs changes, make them now while the only dynamic
  producer is the headlamp.
- Review accumulated debt and fold corrections into the remaining phases.

### Phase 4: Cleanup and wrap-up

- Update [docs/lighting.md](../lighting.md) with the runtime system, the bake-versus-evaluate rule,
  and the outdoor census.
- Record the entity-light attachment point for the dynamic-entity runtime plan.
- Remove or deliberately promote the Phase 0 census harness.
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
- **Per-vertex loop cost.** A light loop runs per vertex on every receiver. Terrain is _not_ the
  worry: a landblock is 9x9 = 81 vertices, so fifty resident landblocks total roughly 4,000
  vertices, less than one building. Buildings and objects carry the vertex count. Mitigation:
  unlit landblocks bind an empty static set and take no loop; the Phase 3 resteer measures a dense
  town.
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
- [ ] Static binds track visible lit landblocks, not draw-call count.
- [ ] Outdoor lamps illuminate terrain, buildings, objects, and generated scenery at night.
- [ ] Interiors are visually unchanged and still baked.
- [ ] Selection cap chosen from measurement, with drops observable in a frame metric.
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
