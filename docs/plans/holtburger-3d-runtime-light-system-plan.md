# Holtburger 3D Runtime Light System Plan

Status: Draft — not yet executing.
Created: 2026-08-04

## Goal

Build one runtime point-light system with pluggable producers, and use it to light the outdoor
world with its authored lamps and braziers.

## Scope

**In scope**

- A per-frame light set assembled from independent producers, with bounded nearest-first
  selection.
- Shader evaluation of that set, generalized from the existing single-light viewer headlamp.
- Outdoor authored static lights as the first bulk producer, reaching terrain, buildings,
  explicit objects, and instanced generated scenery alike.
- The viewer headlamp migrated onto the same system rather than remaining a bespoke uniform.

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
4. **Producers are independent and additive.** Adding entity lights later must require no change
   to selection, binding, or shader code.

## North Stars

1. One evaluation path for every runtime light. A second bespoke light uniform is a design
   failure.
2. The system is defined by its producers, not by its first caller. Outdoor statics are one
   producer that happens to land first.
3. Selection is explicit and observable. When lights are dropped, say so in a metric rather than
   silently dimming the world.
4. Cost scales with what is lit, not with what exists. A landblock with no lamps should pay
   nothing.
5. Anything compared against a vertex position lives in anchor-relative space. This has already
   caused one invisible-light bug.

## Phased Implementation

### Phase 0: Evidence

The archive maximum of 51 lights in one landblock is for a landblock in isolation. Selection is
per draw scope, and lights near a boundary reach into the neighbour, so the number that matters is
the worst case _reaching_ set.

Deliverables:

- Extend the outdoor census to compute, for every landblock, the set of lights whose authored
  reach (`falloff * rangeAdjust`) intersects that landblock's bounds, including lights owned by
  the eight neighbours. Report the distribution and the maximum.
- Report how many landblocks exceed candidate caps (16, 32, 64) so the cap is chosen from data.
- Confirm the authored falloff distribution outdoors matches the indoor census (1–15), since the
  reach calculation depends on it.

Acceptance criteria:

- A cap is chosen with the number of affected landblocks stated, or overflow is shown to be
  impossible.

Tasks:

- [ ] Neighbour-inclusive reaching-set census.
- [ ] Cap decision recorded here with its evidence.

Decisions and course corrections: _(fill during execution)_

### Phase 1: Light set, selection, and shader array

Build the mechanism and prove it by migrating something that already works, so this phase changes
no pixels.

Deliverables:

- A `SceneLightSet` contract: a bounded, ordered array of runtime point lights in anchor-relative
  space, assembled per frame from producers.
- Nearest-first selection with an explicit cap, mirroring `Render::insert_light`'s policy — sort
  by squared distance from the camera, keep the nearest, drop the rest — and a frame metric
  counting dropped lights.
- Shared GLSL: generalize `evaluateViewerLight` into a loop over the bound array, preserving its
  current per-light math exactly.
- The viewer headlamp becomes the system's first producer rather than a dedicated uniform pair.

Acceptance criteria:

- Interiors render identically to before, since the headlamp is the only producer and its math is
  unchanged.
- Unit tests cover selection: ordering, cap behaviour, drop counting, and the empty case.
- The shader uniform/varying consistency test covers the new array declarations.

Tasks:

- [ ] `SceneLightSet` type and per-frame assembly.
- [ ] Nearest-first bounded selection with a drop metric.
- [ ] Shader array evaluation replacing the single-light path.
- [ ] Migrate the headlamp onto it; delete the bespoke uniforms.

Decisions and course corrections: _(fill during execution)_

### Phase 2: Outdoor static light producer

Deliverables:

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

Tasks:

- [ ] Per-landblock outdoor light gathering with residency-scoped caching.
- [ ] Neighbour spill inclusion.
- [ ] Per-draw binding across all four outdoor receivers.
- [ ] Browser verification at night, including the late-arriving-layer case.

Decisions and course corrections: _(fill during execution)_

### Phase 3: Resteer

- Re-measure frame cost with lights active in a dense town, and confirm North Star 4 holds for
  unlit landblocks.
- Confirm the producer interface is genuinely additive by sketching, without building, how entity
  lights would attach. If it needs changes, make them now while there is one producer.
- Review accumulated debt and fold corrections into the remaining phases.

### Phase 4: Cleanup and wrap-up

- Update [docs/lighting.md](../lighting.md) with the runtime system, the bake-versus-evaluate rule,
  and the outdoor census.
- Record the entity-light attachment point for the dynamic-entity runtime plan.
- Remove or deliberately promote the Phase 0 census harness.
- Sweep vocabulary: nothing should describe the headlamp as a special case once it is a producer.

## Risks & Mitigations

- **Per-vertex cost on terrain.** Terrain is the highest vertex count in view, and a light loop
  runs per vertex. Mitigation: unlit landblocks bind an empty set and skip the loop entirely; the
  Phase 3 resteer measures a dense town before the design is locked. If it bites, the fallback is
  restricting the loop to object draws and leaving terrain on sun and ambient, which is strictly
  better than today.
- **Selection error at range.** Nearest-to-camera selection can pick the wrong lights for distant
  geometry. Mitigation: this is why interiors stay baked. Outdoors the emitter count per landblock
  is small (~3.6 average) and the cap is chosen in Phase 0 to make dropping rare.
- **Anchor-space mistakes.** Light positions compared against vertex positions must be
  anchor-relative; this has already produced one invisible light. Mitigation: `anchorRelativePosition`
  is the single owner of that conversion and every producer routes through it.
- **Cache invalidation on residency changes.** A cached per-landblock set must be rebuilt when the
  Objects layer arrives, changes, or is withdrawn. Mitigation: key the cache by the same interest
  revision the layer artifacts already use, so a stale set cannot outlive its source.

## Definition of Done

- [ ] One shader path evaluates every runtime light; no bespoke single-light uniforms remain.
- [ ] Outdoor lamps illuminate terrain, buildings, objects, and generated scenery at night.
- [ ] Interiors are visually unchanged and still baked.
- [ ] Selection cap chosen from measurement, with drops observable in a frame metric.
- [ ] `npm run check` (by exit code), frontend tests, GLSL validation, lint, formatting, and
      `cargo clippy` all clean.
- [ ] Browser-harness verification at night in a lit landblock, including the late-arriving-layer
      case.
- [ ] `docs/lighting.md` updated; entity-light attachment point recorded.

## Open Questions

- Should the cap be per landblock or per draw scope? Per landblock is simpler and matches how
  gathering is cached; per draw would be more precise for large landblocks but needs a selection
  pass per draw unit.
- Does the detail slider eventually scale the cap, as retail's degrade level does? Not needed now,
  but the selection layer is where it would live.
- Do outdoor lights belong to a landblock or to a scene scope once portal-visible outdoor cells
  are considered? Phase 2 assumes landblock; the resteer should confirm nothing about portal views
  contradicts that.
