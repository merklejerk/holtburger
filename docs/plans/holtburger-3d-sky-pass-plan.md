# Holtburger 3D Sky Pass Plan

Status: **Complete 2026-08-06.** All three phases executed and their acceptance criteria met; the
sky renders from production content through both the Tauri app and the browser harness. The
prerequisite [holtburger-3d-scene-lighting-plan.md](holtburger-3d-scene-lighting-plan.md) completed
2026-08-04 and the Phase 0 evidence pass 2026-08-03. Phase 1 completed 2026-08-05 after a census
that corrected several Phase 0 statements (recorded below). One visual artifact was reviewed and
accepted rather than fixed; see the Debt section.
Created: 2026-08-03

## Sequencing

This plan is independent of the dynamic-entity roadmap's authored-effects plan
([holtburger-3d-static-authored-effects-runtime-plan.md](holtburger-3d-static-authored-effects-runtime-plan.md));
neither blocks the other. The Phase 0 evidence pass proved the full celestial deliverable needs no
hook, particle, or physics-script machinery:

- Sky brightness is an instant per-tick material write (`delta = 0.0` never spawns an `FPHook`,
  acclient.c:307121), not timed interpolation.
- `tex_velocity` scrolling is a plain per-frame UV accumulator (`CPhysics::UpdateTexVelocity`,
  acclient.c:299999, driven from the frame update at acclient.c:300119, applied as a mesh UV delta
  in `CGfxObj::TexVelocity`, acclient.c:341519) — a third mechanism separate from both hooks and
  physics scripts.
- Physics-script sky effects (`default_pes_object_id`) and weather objects (`properties` bits 4/8)
  are carried losslessly but not executed here.

Weather is deliberately not part of this plan's deliverable. A future weather feature sits on top
of both this plan (object placement, sky-pass draw policy, the `properties` contract) and the
authored-effects runtime (PES execution, particles), and requires its own concrete plan. Building
weather consumers before the effects machinery exists would violate the roadmap's
no-dormant-infrastructure contract.

### Authored sky-object census (2026-08-05)

A census over the production region's 20 day groups (232 sky objects total) settled what authored
weather and sky-script content actually exists:

- Non-rainy day groups ("Sunny"/"Clear"/"Cloudy", 12 groups) each author 7 sky objects; the 8
  "Rainy" groups author 17-19. The surplus is the weather set: 92 objects with `properties & 4`,
  all confined to Rainy groups.
- Weather content is two kinds: viewer-pinned scrolling rain sheets (GfxObjs `0x01004C42`/
  `0x01004C44` with `tex_velocity` up to `(0.02, -2.0)`, no PES) and Setup-backed emitters
  (`0x02000588`, `0x02000589`, `0x02000BA6` carrying physics scripts `0x33000428`/`0x3300042C`/
  `0x33000453`, properties bits 1+4+8).
- 96 objects carry a `default_pes_object_id`. Notably, one is not weather: `0x02000714` (PES
  `0x330007DB`, properties 0, always-visible window `0..0`) appears in **every** day group,
  including clear skies — the effects runtime gains a celestial script consumer, not just a
  weather one.
- **Scope finding for Phase 2:** `default_gfx_object_id` is not always a GfxObj — `0x02000714`
  and the weather emitters are Setup-family (`0x02`) ids. The always-visible `0x02000714` is in
  celestial scope, so Phase 2 must load Setup-backed sky objects (or Phase 2 execution must pin
  how `GameSky::MakeObject` treats a Setup id) rather than assuming "ordinary `GfxObj`s".

### Phase 0 corrections from the Phase 1 execution census (2026-08-05)

Phase 1 execution began with a fresh census over the shipped `SkyDesc`
(`crates/holtburger-debug-harness/src/bin/sky_census.rs`, temporary). It overturned four Phase 0
statements and pinned three values the plan had guessed. Ground Truth above has been reconciled;
these are the deltas.

- **Replacements are keyed by the authored `object_index`, not by list position.** Phase 0 recorded
  the opposite. Retail matches by pointer identity, but the pointer is bound at load from the
  authored index: `v19->object = v28->m_data[v19->object_index]` (`DayGroup::UnPack`,
  acclient.c:292183). The census proves the distinction is load-bearing: **433** of the shipped
  replacements sit at a list position that differs from their `object_index` (day group 0 authors
  three replacements at indices 0, 1, and 4). Matching by list position would misapply every one.
- **`Frame::grotate` rotates about a global axis, not a local one.** It left-multiplies the
  rotation quaternion onto the frame (acclient.c:342628), and `Frame::rotate` (acclient.c:137544)
  is the local variant that first maps its axis through `m_fl2gv` before delegating to `grotate`.
  The celestial pitch is therefore a rotation about AC's global +Y (north) axis.
- **The authored tick sizes are 0.8 s (sky) and 15 s (light)**, not the 3 s / 20 s retail code
  defaults this plan quoted. Authored day length is 7620 s. At the light tick the fastest authored
  sun sweep (210° over 0.23 of a day) would step ~1.8° at a time, so the sky genuinely needs its
  own, finer cadence rather than riding the lighting quantization.
- **No shipped replacement authors a gfx object id.** Every `SkyObjectReplace.gfx_object_id` in the
  region is zero, so the Phase 2 acceptance criterion "replacements visibly swap (e.g., night sky
  variants)" is unsatisfiable against shipped content and has been struck. Replacements author
  `rotate`, `transparent`, `luminosity`, and `max_bright` only. The resolver still implements the
  swap — it is a real authored capability and costs one line — but it cannot be visually verified.
- **Celestial Setup-family scope is exactly one id.** `properties` histogram over all 20 day
  groups: `{0: 120, 2: 20, 4: 8, 5: 8, 13: 76}`. Bit 1 never appears without bit 4, so the
  after-cell pass is purely weather and celestial scope is `properties & 4 == 0` — 140 objects.
  Of the 96 Setup-family (`0x02`) `default_gfx_object_id` values, 76 are weather emitters
  (properties 13) and 20 are the one always-visible `0x02000714`, one per day group. Phase 2's
  Setup-family work therefore has a single concrete subject.
- **The celestial resource set is 16 unique ids** (15 `GfxObj` + `0x02000714`), not the ~21 this
  plan estimated. Eager residency is even cheaper than assumed.
- **Our keyframe bracketing already matches retail.** `DayGroup::GetTimeOfDay` (acclient.c:290881)
  wraps with a `1.0 - before.begin` denominator rather than our `after.begin + 1`; the two agree
  only when the first keyframe begins at zero. The census confirms every day group's first
  `sky_time` begins at exactly 0, so `bracketKeyframes` is reused unchanged. Recorded because the
  equivalence is a property of the data, not of the code.

## Goal

Replace the flat clear-color horizon with retail's sky: authored celestial objects (sun, moons,
clouds, stars) positioned, brightened, and swapped by day group and time of day.

## Scope

**In scope**

- Celestial position resolution (retail `SkyDesc::GetSky` equivalent): per-object angle
  interpolation over authored begin/end times, plus `SkyObjectReplace` overrides for the active
  `SkyTimeOfDay`.
- A dedicated sky render pass with retail draw policy: fog off, extended far plane, depth always,
  drawn behind the world.
- Sky object materials: instant luminosity/diffuse/translucency values applied per tick (plain
  per-draw material uniforms — see Ground Truth; explicitly NOT hook or script machinery).
- Texture-velocity UV scrolling for cloud layers (`tex_velocity`).
- Explorer debug affordances: reuse the lighting plan's day-group select and time-of-day slider.

**Out of scope**

- Everything covered by the scene lighting plan (sun/ambient illumination, fog resolution, light
  ticking). This plan consumes that time source and environment resolution; it does not own them.
- Physics-script sky effects (`default_pes_object_id`): recorded lossless in the contract, not
  executed — physics-script execution belongs to the authored-effects/dynamic-entity roadmap.
- Weather objects (`properties` bits 4/8): the census found 92 authored across the Rainy day
  groups, but they are viewer-pinned effects requiring the future weather plan (see Sequencing);
  this plan renders celestial objects only.
- Weather beyond authored day groups (retail has none; day-group chance selection already exists).

## Ground Truth

- `GameSky::UseTime` (acclient.c:297724): every sky tick (3 s, `SkyDesc::tick_size`) —
  `CRegionDesc::CalcDayGroup()`, `GetSky(t)` to rebuild celestial positions,
  `CreateDeletePhysicsObjects`, then per object: `GameSky::CalcFrame(heading, rotation)` +
  `set_frame`, and material values applied with `delta = 0.0`.
- The `delta = 0.0` fact (proven, acclient.c:307121): `CPhysicsObj::SetLuminosity`/`SetDiffusion`/
  `SetTranslucency` only spawn an interpolating `FPHook` when `delta >= 0.0002`; at zero they set
  the part-array material value immediately. Sky brightness is therefore an instant per-tick
  material write, not timed interpolation, animation hooks, or scripts.
- `SkyDesc::GetSky` (acclient.c:292328): builds the `CelestialPosition` array (acclient.h:17241),
  interpolating each object's angle between `begin_angle`/`end_angle` over
  `begin_time`..`end_time`, then applying `sky_obj_replace` for the current `SkyTimeOfDay`
  (replaced values: gfx object, rotate, transparent, luminosity, max_bright; matched by the
  authored `object_index` field — see the Phase 1 census corrections).
- `GameSky::Draw` (acclient.c:297381): fog forced off (except during environment overrides),
  `zfar * 4`, `DEPTHTEST_ALWAYS`.
- Authored brightness units are 0–100, applied × 0.01; `luminosity` maps to emissive,
  `max_bright` to diffuse, `transparent` to translucency (alpha `1 - t`).
- `GameSky::MakeObject` consumes `default_gfx_object_id`, `tex_velocity`, and `properties` bits
  (call site acclient.c:297707-297714). Full bit semantics are pinned in the Phase 0 findings:
  bit 4 marks a weather object (viewer-pinned, not celestial).
- Sky objects live in a dedicated sky cell (`before_sky_cell` handling in
  `GameSky::CreateDeletePhysicsObjects`); frame math in `GameSky::CalcFrame`. Camera relation and
  `sky_height` are pinned in the Phase 0 findings: CalcFrame is orientation-only and `sky_height`
  is write-only in retail.

### Existing code touch points

- Rust: full `SkyObject`/`SkyObjectReplace` data already parsed —
  `crates/holtburger-dat/src/file_type/region.rs:137-173` (begin/end time and angle,
  tex velocity, gfx and PES object ids, properties; replacements incl. rotate, transparent,
  luminosity, max_bright).
- Tauri boundary already serializes the whole `SkyDesc`
  (`apps/holtburger-3d/src-tauri/src/lib.rs:586-621`); frontend decodes `skyObjects` and
  `skyObjectReplacements` (`apps/holtburger-3d/src/lib/assets/active-region-source.ts`) — both
  currently unused, as is `skyHeight`.
- Day-group selection (retail hash) and UI select already exist:
  `apps/holtburger-3d/src/lib/game/environment/scene-environment.ts:123-150`,
  `ExplorerWorldPanel.svelte:240-252`. `ResolvedSceneEnvironment.sky` currently carries only a
  name/index — this plan grows it into resolved celestial state.
- Renderer: no sky pass exists; background is the clear color
  (`webgl2-renderer.ts:548`, `:811`). Sky draws get a dedicated program (see Phase 2); the
  existing object/surface resource path is reused for geometry and texture residency.
- Corroboration: ACE server sources under `ACE/`. ACViewer has no sky (`GameSky` commented out,
  `ACViewer/Physics/Common/LScape.cs:28`) — not a reference.

## North Stars

1. The sky is presentation resolved from authored data — resolution lives in the environment
   layer next to day-group and lighting resolution; the renderer only draws resolved state.
2. Reuse the lighting plan's contracts: one time source, one environment resolution path, the
   same explorer controls. No parallel time plumbing.
3. Retail draw policy is part of the look — fog-off, far-plane, and depth behavior are authored
   decisions, not knobs to modernize.
4. Lossless contract: carry `default_pes_object_id` and `properties` through even though this
   plan doesn't consume them; a future effects runtime should not need a schema change.
5. Prove frame math from the decompile before writing it — sky-dome geometry conventions are
   easy to guess wrong and hard to eyeball.

## Phased Implementation

### Phase 0: Decompile evidence

Pin the facts the initial draft could not assert from the decompile, recording each in this plan
(complete — findings below; Ground Truth has been reconciled against them):

- `GameSky::CalcFrame`: exact frame construction from heading/rotation, camera relation, and
  where `sky_height` (and `sky_object_replacements` rotate) enter.
- `GameSky::MakeObject`: full `properties` bit semantics (`& 1`, `& 4`, others), object scale,
  and material defaults.
- Sky cell mechanics: what `before_sky_cell` membership implies for our renderer (draw grouping
  only, or position semantics).
- `CelestialPosition` layout and the precise angle→position mapping in `GetSky`.
- How the environment-override case interacts with sky fog (out of scope to implement; needed to
  avoid painting ourselves into a corner).

Acceptance criteria: each item answered with acclient.c line references in this plan; no
implementation phase contains a guessed formula.

Tasks:

- [x] CalcFrame / sky_height / rotate math.
- [x] MakeObject properties and defaults.
- [x] Sky cell semantics.
- [x] GetSky position mapping.
- [x] Override interaction note.

Decisions and course corrections (decompile pass executed 2026-08-03):

- **CalcFrame is orientation-only** (acclient.c:297365-297379): yaw from `heading` via
  `Frame::set_heading` (degrees, Y-forward), then pitch via `Frame::grotate` about the **global** Y
  axis by `-deg2rad(rotation)` (corrected from "local" — see the Phase 1 census corrections). It
  never writes an origin. Celestial (non-weather) objects sit at
  origin (0,0,0) of the viewer's cell frame each tick — a sky object is a rotated-at-the-camera
  billboard-dome piece, made distant purely by the 4× far plane and depth-always draw. Weather
  objects (bit 4) instead pin to the viewer's XY with z forced to **−120.0** unless bit 8 is set
  (`GameSky::UpdatePosition`, acclient.c:297298-297341).
- **`sky_height` is confirmed write-only in retail** (serialized in `CRegionDesc::Pack`, defaulted
  in `LandDefs::get_vars`, never read by GameSky). Phase 3's schema-cleanup decision is now firm:
  delete it from our decode schema.
- **GetSky mapping** (acclient.c:292328-292514): an object is visible when
  `begin_time == end_time` (always) or `begin_time < t < end_time`; hidden objects get an invalid
  gfx id. The begin/end **angle lerp lands in `rotation` (pitch)**; `heading` is zeroed and only a
  `SkyObjectReplace.rotate` value overrides it. Material defaults are −1 sentinels
  (skip-if-unset). Replacements match by **pointer identity into the day group's object list, not
  `object_index`** — our resolver should match by list index, which is the loader-order
  equivalent. Luminosity/max_bright interpolate between the before/after time-of-day replacement
  pair only when both sides author a positive value (transparent: `>= 0`) **and the after-keyframe
  authors a replacement for the same object**; otherwise the value stays at its −1 default.
  `pes_id`, `rotation`, `tex_velocity`, and `properties` are never replaced. A gfx replacement
  applies unconditionally, so it can make an object visible outside its own begin/end window; a
  `rotate` replacement applies only when non-zero.
- **`properties` bits, complete** (all reads audited): bit 1 = draw in the after-cell pass (drawn
  after landscape; skipped in the before pass); bit 2 = hide while an environment override is
  active with fog on; bit 4 = weather object (viewer-pinned, requires `weather_enabled`, forces
  recreate on toggle); bit 8 = with bit 4, suppress the z = −120 clamp. No other bits exist.
  `MakeObject` applies **no scale and no initial material state**; brightness values are snapped
  every tick in `UseTime`, skipped while at their −1 defaults.
- **Sky cells** are two plain heap EnvCells; membership is draw grouping and removal bookkeeping
  only — positioning is entirely `set_frame` + cell-id propagation. The after-cell is drawn as a
  whole cell after the landscape, and only outdoors with weather enabled.
- **Draw pass details** (acclient.c:297381-297437): `zfar * 4` takes effect by rebuilding the
  projection via SetFOV and is restored after; `DEPTHTEST_ALWAYS` with depth writes off; a
  `m_currentlyDrawingSky` device flag suppresses per-material depth-state changes for the whole
  pass; **fog is ON during the sky pass only under an environment override**, otherwise off.
- **tex_velocity is a global per-GfxObj-DataID UV offset** accumulated per frame
  (`CPhysics::UpdateTexVelocity`, acclient.c:299999) and applied as a whole-mesh UV delta — the z
  component is never used, and scrolling is shared by every instance of the same GfxObj DataID.
  Registration dedupes by DataID with last-writer-wins rates (`CPhysics::AddGfxVelocity`,
  acclient.c:300196); the sky registers directly from `GameSky::MakeObject` via
  `CPhysicsObj::SetTextureVelocity` (acclient.c:305404), which registers every part's GfxObj, so
  Setup-backed sky objects are covered. A `TextureVelocityHook` animation-hook type elsewhere in
  the engine can also feed this registry — the mechanism has a hook client, but the sky's path
  involves no hooks. In shipped sky data each scrolling DataID appears once per active day group,
  so the global-shared quirk is unobservable; our sky module derives phase from the shared clock
  instead of accumulating at all (see Phase 2's state note). A 2026-08-05 archive census confirmed the registry's
  non-sky writers are real: zero `TextureVelocity`/`TextureVelocityPart` hooks in all 2,066
  portal animations, but 11 physics scripts author whole-object `TextureVelocity` hooks
  (flowing-surface rates such as `(0.03, 0.03)`). Those consumers — and retail's
  shared-by-DataID phase semantics that keep tiled instances scrolling in lockstep — belong to
  the authored-effects plan, which adopts the same derived-phase model; the sky module's
  derivation is unaffected.

Follow-on adjustments to later phases: Phase 1's resolver keys replacements by day-group object
index; Phase 2's pass draws celestial objects camera-centered with its own far-extended
projection, and weather objects (bits 4/8) plus the environment-override interaction (bit 2)
remain out of scope until weather/override work exists — but the properties bits ride through the
contract untouched.

### Phase 1: Celestial resolution in the environment layer

Deliverables:

- `scene-environment.ts`: resolve the active day group's sky objects at the current day fraction
  into a `ResolvedSkyState` — per visible object: gfx id, frame (from Phase 0 math), UV scroll
  velocity, luminosity/diffuse/translucency (0–100 × 0.01), with `SkyTimeOfDay` replacements
  matched by day-group list index (the loader-order equivalent of retail's pointer-identity
  matching; the authored `object_index` field is not the key). Objects outside their begin/end
  window resolve absent.
- Contract carries `default_pes_object_id` and raw `properties` untouched (North Star 4).
- Resolution re-runs on the authored sky tick (0.8 s) rather than the lighting tick (15 s); both
  derive from the same clock.

Acceptance criteria:

- Unit tests: window selection, angle interpolation, replacement application, unit scaling —
  against runtime constants, validated against the Phase 0 dump values from the lighting plan's
  region data census.

Tasks:

- [x] `ResolvedSkyState` type and resolver.
- [x] Replacement and windowing logic.
- [x] Tick integration with the shared time source.
- [x] Resolver unit tests.

Decisions and course corrections (executed 2026-08-05):

- **`sky-state.ts` is a sibling of `scene-environment.ts`, not part of it.** The resolver is ~250
  lines against a file already at 320; `resolveSceneEnvironment` calls it and stores the result in
  `ResolvedSceneEnvironment.sky`, which is now `ResolvedSkyState` rather than the old name/index
  pair. Resolution still lives in the environment layer (North Star 1); it just is not one file.
- **Orientation is carried as an AC frame quaternion, not a matrix.** `ResolvedSkyObject.orientation`
  is `[w, x, y, z]` in AC axes, which feeds the existing `acFrameTransform` unchanged. The renderer
  therefore reuses the proven axis conversion instead of the sky module reimplementing it, and the
  contract stays renderer-agnostic. No origin is carried: celestial objects sit at the viewer cell
  origin by construction.
- **Tick quantization moved out of the clock and into the environment layer.** `game-clock.ts`
  previously quantized to the light tick while producing the day fraction, which forced the sky to
  inherit the lighting cadence. It now exposes `resolveDayFraction` (continuous) and
  `quantizeDayFraction` (per-domain), and `resolveSceneEnvironment` applies each authored tick to
  its own domain. This is the layer that knows both cadences, so the derived fact is computed once
  where it is owned. `ExplorerApp` lost its `DEFAULT_LIGHT_TICK_SECONDS` fallback in the process —
  it was only reachable when a region authored no sky, which now short-circuits earlier anyway.
- **`bracketKeyframes` extracted to `keyframe-bracket.ts`.** Lighting and the sky both bracket the
  same authored keyframe list, but at different quantized fractions, so it could not stay private
  to `scene-environment.ts` and could not be hoisted into `sky-state.ts` without inverting the
  dependency.
- **The resolver keeps weather objects and marks them.** `ResolvedSkyObject.isCelestial` is derived
  once from `properties & 4`; raw `properties` and `default_pes_object_id` ride through untouched
  (North Star 4). This mirrors retail, which resolves one array and filters at draw time, and
  leaves the future weather work with nothing to re-derive.
- **Unset material channels resolve to `null`, not to zero.** Retail's −1 sentinels mean "do not
  write", leaving the object's own authored material in place. Collapsing that to zero would
  silently black out every object whose day group authors no brightness replacement — 4 of the 7
  objects in the shipped "Sunny" group. Phase 2 owns the fallback policy because it owns the
  material path.
- **A replacement naming an unauthored object index throws.** Retail writes past the end of its
  array there; failing loudly is the honest translation, and no shipped data reaches it.
- **Concession: quantizing in day-fraction space introduces float error.** `floor(f / tick) * tick`
  can land a hair below an exact tick boundary, so a boundary sample may resolve to the previous
  tick. The visible consequence is bounded by one tick (0.8 s of sky motion), and the alternative —
  quantizing in seconds — would require threading elapsed time rather than a fraction through the
  selection type, re-coupling the resolver to the clock. One existing fog assertion moved from
  exact equality to `toBeCloseTo` as a result.
- **Debt: `crates/holtburger-debug-harness/src/bin/sky_census.rs` is temporary.** It produced the
  corrections above and the authored values the resolver's tests are written against. Delete it in
  Phase 3 unless Phase 2 needs another pass over the same data.

### Phase 2: Sky render pass

Architecture: a dedicated sky module (retail-shaped, mirroring `GameSky`) sitting between
environment resolution and the raw renderer. The environment layer resolves; the sky module owns
every piece of sky-specific runtime state; a dedicated program draws. Concretely, the module
owns:

- The sky's GPU resources, loaded eagerly at region load. The census proves the resource set is
  closed and tiny (16 unique ids across all 20 day groups), so on-demand machinery is
  unwarranted and eager residency eliminates pop-in on day-group rollover or slider scrubbing.
- Pass submission under retail policy: own far-extended projection, depth test always /
  depth-write off, no fog.

### What the sky borrows, and what it does not

The object path is five stages, and the sky's answer differs by stage. Naming them separately
prevents "reuse the object pipeline" from meaning two incompatible things:

| #   | Stage                                                                     | Owner                                                | Sky       |
| --- | ------------------------------------------------------------------------- | ---------------------------------------------------- | --------- |
| 1   | Host projection: DAT id to definitions, geometry, materials, texture deps | `ObjectResourceClosure` (Rust)                       | reuses    |
| 2   | Record decode to `ResolvedObjectPresentation`                             | `decodeStaticGeometry` / `Material` / `Presentation` | reuses    |
| 3   | Template prep to `RigidPartDrawUnit` plus `ObjectMaterialBinding`         | `prepareObjectVisualTemplate`                        | **skips** |
| 4   | Residency: geometry upload plus atlas claims                              | `ObjectVisualTemplateRepository`                     | **owns**  |
| 5   | Draw: `AssetTextureKey` to atlas page and pixel rect, object program      | `webgl2-renderer` object path                        | **owns**  |

Stages 1-2 are resource decoding, not layer machinery, and reusing them is what retail does: a sky
object is a `CPhysicsObj` built by the same `makeObject` / `InitPartArrayObject` as every other
object, taking its part array from a GfxObj (`DivineType` 6) or a Setup (type 7). There is no sky
mesh or material format. `GameSky` owns placement, orientation, and draw policy — never geometry or
surfaces — and this module matches that split.

**The sky is a sibling of the landblock layer system, not a member of it.** The test is whether it
participates in that system's mechanics: scene interest, streaming residency, frustum culling, and
portal traversal. The sky does none of the four — it is regional, permanently resident,
camera-centered, and drawn in its own pass with its own projection. It therefore gains no
`LandblockLayerKind`, and its record carries no landblock id, no layer, and no residents.

**Debt paid here: `OutdoorStaticSourceClosure` is renamed to `ObjectResourceClosure`.** Its job is
DAT-family dispatch and deduplication into shared geometry/material/texture buffers — nothing
outdoor, nothing static, nothing layer-shaped. The name already misdescribed `env_cell_source.rs`,
whose caller named its local binding `object_closure` to compensate; the sky would have been the
third caller the name lied to. `OutdoorStaticSourceRecordManifest` keeps its name, because that
record genuinely is outdoor-static-shaped: it has residents and a layer.

The module owns no mutable per-frame state: UV scroll phase is derived, not accumulated —
`phase = fract(tex_velocity × sharedClock)`, computed in f64 CPU-side before reaching f32
uniforms. Retail accumulates instead (`total += rate × dt`, wrap at 1.0), but for constant
authored rates the two are identical up to an unobservable phase origin, and every authored sky
rate is constant. This is the same derived-phase model the authored-effects plan adopts for
script-driven scroll (recorded in its Measured Workload section), so the two consumers share the
clock and the arithmetic rather than any state.

Deliverables:

- The sky module as above, consuming `ResolvedSkyState` and invoked by `webgl2-renderer.ts`
  before the world pass.
- A dedicated sky shader program: transform, texture sample plus UV offset, indexed-palette decode,
  alpha test, luminosity/diffuse scalars, alpha from translucency. The object program is not reused
  — it is built around lighting roles, fog, and per-material depth state the sky must neutralize
  (retail suppresses the same machinery with its `m_currentlyDrawingSky` device flag).
- **Sky-owned standalone textures, not atlas pages.** The 28 authored sky surfaces are 18 `r8g8b8`,
  7 `a8r8g8b8`, and 3 `index16` (with 2 palettes). Uploading them as plain `TEXTURE_2D` resources
  keyed by `AssetTextureKey` costs a map and a loop over `WebGL2ResourceManager.createTexture2D`,
  and buys the sky the one thing the atlas cannot give it: native `GL_REPEAT` for the scrolling
  cloud layers. Atlas pages must clamp — `#prepareObjectTextureBinding` hardcodes
  `TextureWrapMode.Clamp` — so atlased repeat has to be emulated in the shader with `fract` plus
  explicit `textureGrad` gradients to stop seams selecting coarse mips. The sky's `tex_velocity`
  layers are exactly that case. Atlasing exists to cut texture binds across thousands of object
  draws; the sky submits roughly seven per frame and gains nothing from packing.
- Celestial Setup-family scope is exactly `0x02000714` (one per day group, always visible,
  `properties` 0), loaded through the same Setup part-array projection as any other Setup id.
- UV scrolling from `tex_velocity` as derived phase from the shared clock (see the module's
  state note above).

Acceptance criteria:

- [x] Sun/moon/clouds render and move when scrubbing the time-of-day slider; objects appear/
      disappear at authored windows; authored brightness and translucency replacements visibly track
      the keyframes. (Gfx-swap replacements are implemented but unverifiable — no shipped
      replacement authors a gfx id; see the Phase 1 census corrections.)
- [x] Horizon no longer terminates in flat clear color outdoors.
- [x] Sky draws are excluded from fog and never occlude world geometry.
- [x] Frame-profiler cost of the pass recorded; no regression to world pass timings.

### Verification record (2026-08-06, production content, landblock `0xda55ffff`, yaw 90)

| Day fraction | Observed                                                               |
| ------------ | ---------------------------------------------------------------------- |
| 0.02         | Night: dark sky, star field, cloud layers, **moon low at the horizon** |
| 0.20         | Dawn: **sun near the horizon**, stars fading, sky brightening          |
| 0.50         | Midday: full blue gradient, horizon glow, lit clouds, no stars         |
| 0.85         | Evening: bright sky, sun set and absent, faint stars returning         |

That sequence exercises every criterion. Different celestial objects appear at different fractions,
which is authored-window selection working; the moon and sun occupy different positions, which is
the begin/end angle interpolation working; and overall brightness tracks the keyframes from a dark
night to a bright midday, which is the luminosity and `max_bright` replacement chain working. In
every capture the terrain draws over the sky, confirming the depth-always/no-write ordering leaves
the sky unable to occlude world geometry. The horizon renders authored sky rather than clear colour.

**Frame profile** (SwiftShader, 3 s steady-state measurement, midday, yaw 90): total renderer CPU
**0.127 ms/frame**, of which terrain submission is 0.003 ms and opaque and blended submission are
both 0.000 ms — unchanged from a world pass without the sky. The sky's own cost falls into
`otherMs` at **0.082 ms/frame**, because the pass is not a named profiling phase. Cheap enough that
the eager-residency decision needs no revisiting.

**Debt:** the sky is not a named renderer profiling phase, so its cost is only visible as part of
`otherMs`. Add a `sky` CPU/GPU phase alongside `terrain`, `opaque` and `blended` when the pass next
needs performance attention.

Tasks:

- [x] Host boundary and record decode (not in the original task list — see below).
- [x] Rename `OutdoorStaticSourceClosure` to `ObjectResourceClosure`.
- [x] Extract `resolveObjectMaterialRanges` as the shared triangle-coalescing primitive.
- [x] Sky module skeleton: resource ownership, eager region-load policy, `ResolvedSkyState`
      consumption.
- [x] Sky-owned standalone texture residency.
- [x] Dedicated sky shader program.
- [x] Pass ordering, depth/fog policy, far-plane handling.
- [x] Install seam: `GameRuntime.installSky` through the neutral `Renderer.sky` capability.
- [x] Setup-family sky object handling (pin `MakeObject` semantics first).
- [x] UV scroll derived phase.
- [x] Visual verification across day fractions and camera orientations (see the verification record
      below). Multi-day-group verification remains unavailable: the harness selects the day group by
      the retail date hash and exposes no override, so only the hashed group is reachable.

Decisions and course corrections (in progress):

- **Setup-family sky objects need no special handling — pinned.** `GameSky::MakeObject` calls
  `CPhysicsObj::makeObject` (acclient.c:309060), which reaches `InitPartArrayObject`
  (acclient.c:307951). That dispatches on `MasterDBMap::DivineType`: type 6 builds a
  `CPartArray::CreateMesh` from a `GfxObj`, type 7 builds a `CPartArray::CreateSetup` from a Setup
  model. A Setup-family sky object is therefore loaded exactly like any Setup-backed static —
  base appearance, parts, default placement frames — with no sky-specific branch. Our host already
  implements both halves of that dispatch in `OutdoorStaticSourceClosure::add_resident`
  (`apps/holtburger-3d/src-tauri/src/outdoor_static_source.rs`), which switches on the same two DAT
  families.
- **Scope gap: "the existing object resource path" does not reach a regional consumer.** The plan
  assumed sky geometry and materials could ride the existing object resource path. That path is
  landblock-batch-shaped end to end — request, record, and decode are all keyed by landblock id and
  layer — and the sky is regional, fetched once, never per scene-interest change. Closing the gap
  needed a new narrow host boundary, which AGENTS.md sanctions for the app-local adapter:
  - `apps/holtburger-3d/src-tauri/src/sky_source.rs`: walks the region's `SkyDesc`, collects every
    DAT id a celestial draw can reach — both `default_gfx_object_id` and any non-zero replacement
    gfx id, since a replacement applies unconditionally — and projects them through the **existing**
    `OutdoorStaticSourceClosure`. Only the resource closure crosses; placement stays frontend-side
    per sky tick, so the record carries no residents.
  - `load_sky_source` Tauri command plus a `/sky-source` route on the dev content host, so the
    browser harness and the app share one builder.
  - `apps/holtburger-3d/src/lib/assets/decode-sky-record.ts`: reuses `decodeStaticGeometry`,
    `decodeStaticMaterial`, and `decodeStaticPresentation` exactly as `decode-env-cell-record.ts`
    already does, so only the record envelope is new.
  - Verified end to end against production content: the record is **61 KB**, 16 objects, 16
    definitions (15 `gfx-obj` plus `setup-model/02000714` with one part carrying PES `0x330007db`),
    28 materials, 30 texture dependencies. Eager residency is confirmed free.
- **Resolved: the visual-template repository can host the sky, cheaply.** `ObjectVisualTemplate`
  preparation reads only `setupId`, `presentation`, and `localBounds` — `sourceFingerprint` and
  `objectVisualTemplateKey` touch nothing else, and `identity`, `scale`, `placement`, and
  `behavior` are never read. Narrowing `stageOwner`/`prepare` to a
  `Pick<AuthoredDynamicSource, "setupId" | "presentation" | "localBounds">` input is a strict
  subtraction: `AuthoredDynamicSource` still satisfies it structurally, so no dynamic-entity call
  site changes, and the sky becomes an ordinary owner (`stageOwner` → await → `commit`). The sky
  will not need a private geometry or atlas path.

- **Course correction (2026-08-06): the sky skips stage 3 and owns stages 4-5.** The first Phase 2
  sketch routed the sky through `ObjectVisualTemplateRepository`, which would have made it an atlas
  owner with a claim/revision/withdraw lifecycle and a dependency on the async layout and
  page-build workers. Two review questions dismantled that: the sky's materials never needed detail
  (unreachable through that path at all), and atlasing served the sky nothing while actively
  costing it native texture repeat for the scrolling cloud layers. The narrowing of
  `stageOwner`/`prepare` onto a `Pick<AuthoredDynamicSource, ...>` input is therefore **not
  executed** — it was only ever needed to let the sky in, and the sky is no longer going in. It
  remains a legitimate standalone cleanup for whoever wants it; it is not this plan's debt.

- **The rename was a split, not a move.** `outdoor_static_source.rs` held two unrelated things: the
  shared resource closure (~540 lines) and the outdoor-static record envelope (~40). Renaming the
  file wholesale would have relocated the lie rather than removed it, so the closure, shared
  geometry buffers, and the material/setup projection helpers moved to
  `object_resource_closure.rs`, and `outdoor_static_source.rs` shrank to the record magic,
  manifest, and serializer it actually names. Three callers repointed; the emitted sky record is
  byte-for-byte identical before and after, which is the regression check that matters for a
  refactor of a serializer's dependencies.
- **`resolveObjectMaterialRanges` extracted to `commit/object-material-ranges.ts`.** Coalescing an
  authored part's triangles into contiguous single-material spans was private to
  `materialPartitions` inside the visual-template repository, and the sky needs exactly the same
  loop without the batching identity wrapped around it. The span type carries `bindingId` and lets
  callers derive their own identity, so `materialPartitions` now maps spans to
  `RigidPartDrawUnit`s and the sky will map the same spans to its own draw list. This is the
  genuinely shared stage-3 primitive; the repository itself remains skipped.
- **Debt noted, not paid: `detailRole: null` is now stated once, with a reason.** The extracted
  helper hardcodes it like its predecessor did, but comments why — detail is selected by an owning
  static render domain and no part-level source carries one. If a part-level detail source ever
  appears, this is the single place that has to change.

**Phase 2 resumed 2026-08-06.** The Tauri adapter
(`tauri-sky-source.ts`) was written and then removed rather than landed unused: its only consumer is
the sky module, and the HTTP/dev-host path is what Phase 2 verification uses. Re-adding it is ten
lines mirroring `tauri-active-region-source.ts`. The `SkySourceLoader` interface and the record
decoder are reachable from `HttpLandblockContentSource` but have **no runtime consumer yet**; that is
in-flight Phase 2 work, not a landed increment, and it must not outlive this phase unconsumed.

**Landed since:** `WebGL2SkyPass` (residency plus draw), `webgl2-sky-program.ts`, and the renderer
pass hooks. Concretely:

- **Residency is private and eager.** `WebGL2SkyPass.prepare` walks the decoded presentations,
  uploads one geometry per part, accumulates texture facts through `resolveObjectMaterialRanges`,
  and materializes each fact with `TexturePreparer.prepare` into
  `WebGL2ResourceManager.createTexture2D`. No `TextureManager`, no atlas delegate, no lease
  registry — the sky's set is fixed for the region, so leases would buy nothing. Avoiding
  `TextureManager` also removes a real hazard: its `#createAssetTexture` short-circuits whenever the
  packed-atlas delegate already holds a binding for a key, so routing the sky through it would have
  made sky residency depend on whether some unrelated world object happened to atlas the same
  surface first.
- **`createTexture2DUpload` exported from `texture-manager.ts`.** The purpose-to-device mapping is
  the one piece of that manager the sky genuinely shares; the sharing machinery around it is not.
- **Part transforms compose through `composeObjectPartTransform`.** `ResolvedObjectPart` carries no
  placement — poses live in `presentation.placementPoses`, and setup-default geometry scale composes
  at use time. Sky objects carry no source scale of their own, so the composition uses unit scale.
- **Draw policy is retail's, restated locally.** Depth test always with depth writes off, blending
  on, culling off, no fog, and its own projection built with `SKY_FAR_PLANE_SCALE`. The sky draws
  first into an untouched depth buffer, so the world pass simply paints over it — which is why the
  sky needs no visibility test of its own, indoors or out, and cannot occlude world geometry.
- **The view matrix is stripped of translation** (`skyViewMatrix`) rather than the resolved contract
  carrying camera state. Retail gets the same result by writing an identity-origin frame per tick.
- **Unauthored material channels fall back to the surface's own values**, never to zero — retail
  skips the write entirely at its -1 sentinel, and 4 of the 7 objects in the shipped "Sunny" group
  author no brightness replacement.
- **`PreparedViewGeometry` now carries its `Camera`** so the sky can rebuild a far-extended
  projection without touching the world pass's matrices.
- **The sky program links lazily**, on first `setSkyPass` with a non-null pass, so a region without
  authored sky never pays for a program it cannot use.

Unit tests cover the derived scroll phase (including the negative authored rates the shipped cloud
layers use) and the view-translation strip.

**Install seam resolved 2026-08-06: the runtime installs the sky.** It is region-scoped content like
terrain and landblock layers, and `GameRuntime` already holds both the `TexturePreparer` and the
renderer. To avoid leaking a WebGL2 type into the neutral `Renderer` port, the port gains an optional
`sky?: RendererSkyCapability` — mirroring the existing optional `frameDiagnostics?` — whose
`install(source, preparer)` takes only frontend-neutral types, so a backend's private pass
representation never crosses the boundary. `GameRuntime.installSky` calls it; the Explorer and the
browser harness each call that once after the active region loads. A backend without the capability
resolves without one rather than failing the region load.

**The sky draws.** First runtime verification (browser harness, production content, landblock
`0xda55ffff`, day fraction 0.5) renders authored cloud layers, a horizon gradient, and the sun
sprite. Terrain draws over the sky correctly, confirming the depth-always/no-write ordering: the sky
neither occludes world geometry nor is occluded by it.

**Two defects were found, diagnosed, and fixed; one open question remains.**

1. **Brightness double-counted, saturating surfaces to white (fixed twice — the second fix is the
   correct one).** The first attempt summed the two authored channels and clamped:
   `color.rgb * min(uDiffuse + uLuminosity, 1.0)`. That removed the worst blow-out but was still
   wrong, and review caught it: with every shipped keyframe authoring `max_bright` **equal to**
   `luminosity`, the sum saturates for any value at or above 0.5, so most of the day rendered at
   full brightness with no variation, and day groups authoring higher values looked uniformly
   overexposed.

   The retail evidence settles the combination. `CPhysicsPart::SetLighting` (acclient.c:303784)
   writes **luminosity into the fixed-function material's `Emissive`** and **`max_bright` into its
   `Diffuse`** (`CMaterial::SetLuminositySimple` / `SetDiffuseSimple`, acclient.c:345688, 345702).
   In D3D9 fixed-function, `Diffuse` contributes **only where a light illuminates the surface**, and
   the sky pass is unlit — so **only the emissive term drives sky brightness**, and authored
   `max_bright` is inert there. The correct expression mirrors the object program's
   `min(vLighting + uLuminosity, 1.0)` with the lighting term at zero:

   `color.rgb * uDiffuse * min(uLuminosity, 1.0)`

   where `uDiffuse` is now the **surface's own diffuse scale** (the same texture modulation the
   object path applies) rather than authored `max_bright`.

   **That emissive-only model was then disproved by observation and reverted.** The night star layer
   `0x010015EF` authors luminosity 0, on a surface (`0800004d`) that also carries luminosity 0, so
   an emissive-only expression renders it black and the stars vanish from the night sky. Something
   therefore supplies a base brightness in retail's sky pass the way `vLighting` does in the object
   program — the pass is not unlit, or the material's Diffuse reaches the result by some path not
   yet identified. The shipped expression is back to the clamped sum
   `color.rgb * min(uDiffuse + uLuminosity, 1.0)`, with `uDiffuse` carrying authored `max_bright`
   and falling back to the surface's diffuse scale.

   **Still open: rainy and cloudy day groups blow out during the day.** Their cloud layer
   `0x01004C35` is a different kind of surface from the sunny groups' `0x01004C36`: flags `0x10114`
   (`SURFACE_ADDITIVE` set, versus `0x102`), a surface translucency of 0.25 rather than 0, and a
   texture (`0x05001470`) whose RGB is a **flat cream (251, 233, 196)** with all of its shape in the
   alpha channel. Additively blending a flat cream sheet over a lit backdrop is a white-out by
   construction. This is not authored intent: the celestial keyframe values are identical across
   Sunny, Cloudy and Rainy (luminosity 90, `max_bright` 90), and Cloudy groups 12-14 share Rainy's
   exact celestial object set, so both blow out together. Retail renders these groups as a dark,
   low-contrast grey-brown overcast.

   **Root cause, found in retail's blend selection: `objectBlendPolicy` was missing
   `SURFACE_TRANSLUCENT`.** `D3DPolyRender` (acclient.c:434096-434160) chooses a blend in stages,
   and the last stage is an override our mapping did not implement:

   1. `0x100` ALPHA (with `0x10000` ADDITIVE) selects `SRCALPHA / ONE`.
   2. `0x4` CLIP_MAP then sets retail's `singlePassDetailing` flag.
   3. `0x10` TRANSLUCENT overrides the blend to `SRCALPHA / INVSRCALPHA` whenever
      `skipChk || !blendSelected || singlePassDetailing` — which step 2 has just made true — and
      sets the vertex alpha to `1 - surface.translucency`.

   The overcast cloud sheet carries all four bits (`0x10114`), so **retail alpha-blends it at 0.75
   alpha; it is never additive.** Our mapping stopped after step 1 and blended additively, which
   saturated a flat cream sheet over a lit backdrop into pure white. Midday overcast now renders as
   warm grey-brown cloud structure over a bright sky rather than a white-out.

   The fix lands in the shared `objectBlendPolicy` rather than the sky pass, because the mapping was
   simply wrong for that flag combination wherever it is used, and the sky pass now consumes that
   shared policy instead of deriving a blend from its ordering class.

   **Blast radius measured, not assumed.** A census over all 6,152 authored `CSurface` records found
   203 additive and 261 translucent surfaces, but **exactly one** carries the
   additive-plus-translucent-plus-clip-map combination that this override changes: `0x08000023` —
   the overcast cloud sheet itself. Every other combination was checked against retail's staged
   logic by hand and is unaffected: `0x10104` (19 surfaces) and `0x10110` (2) correctly keep their
   additive destination because they lack the translucent and clip-map bit respectively, and
   `0x00014` (27) already resolved to alpha blending. So the shared change alters one surface in the
   whole archive, and it is the one being corrected.

   **Method note:** the harness previously hardcoded `dayGroupOverride: 0`, so every sky capture
   before this point was the Sunny group and no rainy or cloudy content was ever exercised. A
   `--day-group` option now exists, which also closes the Definition of Done's multi-day-group gap.

2. **Additive surfaces blended as alpha (fixed).** The sun sprite composited its black backing
   square over the sky. The pass applied one blend mode to every range while
   `ObjectMaterialRange.ordering` already carried the class; blending is now per range, with
   `additive` selecting `SRC_ALPHA`/`ONE` so a black backing contributes nothing.

**Ruled out by experiment: the far plane, and geometry coverage.** Both were the obvious suspects
and both were wrong, which is why they are recorded rather than quietly dropped:

- The pass originally scaled the _active camera's_ 2000-unit far plane by retail's fourfold
  extension, giving 8000 — short of the authored cloud sheets, whose far corners sit about 14285
  out. A real bug, fixed below. But captures before and after were pixel-identical, re-verified on
  a fresh Vite port to exclude a stale dev server, so clipping was never the visible cause.
- A ray-cast coverage test over the drawn set (72 triangles, 1584 sampled directions from -20 to 90
  degrees elevation) found **99.7 percent covered**. The authored sky is not a dome: `0x010015EE`
  is a four-sided box wall spanning y -500.8 to 1050.8 at radius 1050.8, and `0x01004C36` is a
  shallow pyramid with its apex at y 780 and skirt out to radius 14266. Together they close the
  sphere. Nothing was missing; it was being drawn white.

**CLOSED 2026-08-06 as accepted, not fixed.** Reviewed against the running Explorer with a full
world loaded and judged not worth further work: the cloud layer draws over the affected wall, so it
reads as ordinary overcast, and terrain covers the band where it is most visible. Recorded here in
full because the cause was never found — if a future change makes sky gradients more prominent, or
someone sees banding on a backdrop wall, start from the reproduction below rather than from scratch.

**Reproduction, after every fix in this plan:** day group 0, day fraction 0.5,
camera pitch −10, **camera yaw 45**. That faces a corner of the backdrop box, so two adjacent walls
fill the frame either side of the corner seam. The right wall renders correctly — deep blue grading
through cyan to the yellow horizon glow. The left wall renders **flat**: one uniform olive tone
above the horizon and one uniform blue below, with no vertical gradient. The cloud layer still draws
over it, which is why the defect reads as ordinary overcast at a glance and is easy to miss while
flying; it is obvious only when a correct and an incorrect wall are visible side by side. Whether a
wall is affected depends on view orientation, not on which wall it is.

The investigation below predates the brightness and blend fixes and used the vocabulary of "wedges",
meaning the same flat wall panels seen at the frame edges from other angles.

**Open: pale wedges where the opaque backdrop shows through.** Three hypotheses were tested and
**all three disproved**, which is worth recording so nobody re-runs them:

- _Missing geometry._ Per-object ray casts show the cloud pyramid `0x01004C36` covers **every**
  sampled direction including the zenith. Nothing is uncovered.
- _Far-plane clipping._ Real bug, fixed (see `SKY_FAR_PLANE` below), but before/after captures were
  pixel-identical on a fresh Vite port.
- _Texture wrap not reaching the sampler._ Forcing `Repeat` appeared to change exactly the wedges,
  which looked decisive. It was not: an offline probe that decoded the shipped record and ran
  `resolveObjectMaterialRanges` over it printed `repeat` for both tiling layers and `clamp` for the
  backdrop, exactly as authored. The apparent change was **cloud scroll phase**, since
  `tex_velocity` advances with the shared clock and each harness run captures at a different
  elapsed time. A screenshot diff across runs is not a controlled experiment for anything that
  animates.
- _Face culling._ Enabling authored `polygon.cullFace` changed nothing measurable, and the authored
  value is derived for objects viewed from **outside** while the camera sits inside every sky mesh.
  Reverted rather than kept: it had no demonstrated benefit and carries a real risk of rejecting
  the faces the viewer needs.

What is now known about the day group under test (Sunny, day fraction 0.5): `0x010015EE` is the
opaque backdrop (9 ranges, clamp, UVs 0..1), and `0x010015EF` and `0x01004C36` are **transparent**
layers (20 and 24 ranges, repeat, UVs 0.4 to 4.6). Draw order is backdrop then layers, which is
correct back-to-front. Authored `transparent` resolves to translucency 1.0 for `0x010015EF` at
midday — alpha zero, so that layer is deliberately absent — leaving backdrop plus `0x01004C36`.
The wedges are therefore the backdrop showing through wherever `0x01004C36` contributes no alpha.

That diagnostic has now run, and it settles the "maybe it is authored-correct" question: **it is
not.** Decoded pixel evidence, fetched through the host texture-pixels path:

- `0x01004C36`'s texture (`0x0500146E`, 256x256 rgba8) is a **sparse cloud sheet**: alpha mean
  42/255, 37 percent of texels fully transparent, none fully opaque, with alpha spread evenly
  across rows and columns rather than banded at the edges. It is a detail layer, not a backdrop,
  and it is expected to let the backdrop through nearly everywhere.
- The backdrop `0x010015EE`'s four wall textures (`0x050016B1`, `0x050016AD`, `0x050016AE`,
  `0x050016B8`) are **all blue sky gradients** — dark blue at the top (about 40, 60, 120) grading
  to pale blue at the bottom (about 110-160, 130-200, 150-205). **None is pale yellow.**

So the wedges show the backdrop, the backdrop's authored textures are blue, and the wedges render
pale yellow. That is a rendering error in this pass, not authored content and not a missing layer.

**Narrowed to bad texture coordinates.** A UV visualization pass — fragment output replaced with
`fract(vTextureCoordinate)` — shows smooth, well-formed UV gradients across the whole sky _except_
the defect region, which renders as dense black-and-yellow speckle. That is the signature of
texture coordinates large enough that `fract` cycles many times within a single pixel. Every
authored UV range in the record is small (`0x010015EE` spans 0..1; the two tiling layers span 0.4
to 4.6), and `uTextureOffset` contributes at most one unit, so the coordinates reaching the vertex
stage for those triangles are not the authored ones. Sampling garbage UVs against a clamped or
heavily aliased texture is exactly what produces a flat pale fill.

**Correction: that reading was contaminated, and the UV theory is now also disproved.** The debug
shader forced alpha to one, so objects that are _normally invisible_ rendered opaque in that
capture — including `0x010015EF`, whose authored `transparent` resolves to translucency 1.0 at
midday. The speckled region belongs to such a layer and is a debug artifact. The regions that
actually show the defect in production rendering displayed **smooth, well-formed UV gradients**, so
their texture coordinates are fine.

A buffer-offset audit confirms the record is not at fault either: the 16 geometries pack into the
shared sections with consistent, non-overlapping offsets, and the totals reconcile exactly (939
vertices to 2817 position elements, 1878 texture-coordinate elements, 939 indices).

So the defect region has correct geometry (coverage ray cast), correct UVs (visualization), correct
authored textures (all four backdrop walls are blue gradients), and a correct record layout — yet
renders pale yellow. That points at **texture selection or binding**: which resource
`WebGL2SkyPass.resolveTexture` hands each range, rather than the geometry or coordinates it is
sampled with. That diagnostic has now run too, and it also comes back clean: the backdrop resolves
nine ranges across its four authored textures, each range naming its own distinct
`asset-texture:object-direct-color:0x0500...` key, and the cloud pyramid resolves 24 ranges all
naming its single texture. No sharing, no mis-resolution.

**Offline diagnosis is exhausted.** Everything reachable without a running GL context now checks
out: geometry coverage, texture coordinates, record buffer offsets, authored texture content,
per-range texture keys, per-range material values, and the resolved brightness inputs (the backdrop
is authored at roughly 0.95 for both channels at midday, which clamps to full brightness against a
blue gradient and cannot produce pale yellow). Mip generation is also ruled out — `createTexture2D`
calls `generateMipmap` whenever it allocates more than one level.

Two further runtime tests then ran, each changing exactly one variable:

- **Raw sampled texture, production alpha and blend untouched.** Replacing the fragment output with
  the sampled colour — keeping the brightness uniforms referenced so the compiler could not strip
  them — left the wedges pale yellow. The brightness maths is therefore not the cause, and neither
  is the alpha or blend state.
- **Frame clear forced to magenta.** Only the region below the horizon turned magenta. The wedges
  did not. They are **drawn sky geometry**, not the frame clear showing through a coverage gap.
  (This also corrected a misreading: in captures taken without `--building-radius`, the tan band at
  the bottom was the clear colour, not terrain.)

So the wedges are sky geometry, sampling a texture whose authored content is a blue gradient, and
emitting pale yellow before any brightness maths is applied. Everything that determines that sample
— texture key, resource mapping, texture coordinates, wrap mode, material kind — has been verified
correct offline. The contradiction is now sharp enough to be the whole remaining question: the
sampled colour disagrees with the texture that the pass believes it bound.

**Isolated to the backdrop's own walls, sampling a degenerate V.** Two more single-variable runs
closed the fork:

- **Draw only `0x010015EE`.** It renders a correct blue gradient with a yellow horizon band across
  the wall facing the camera — and the wedges are still there. Nothing else is drawn, so the
  backdrop produces both the correct wall and the wedges.
- **Force level-zero sampling** (`mipLevels: 1` at the sampler request). No change, so mip
  selection is not involved.

Measured pixels rather than eyeballed: the wedge reads **(253, 253, 208)**, the frame clear reads
(220, 200, 195), and the correct sky centre reads (63, 86, 136). The wedge is therefore drawn, not
cleared — and (253, 253, 208) is the colour of the **horizon-glow row** in the middle of the
backdrop's gradient texture. Those wall ranges are sampling a near-constant V pinned at that row
rather than traversing the gradient.

That per-range check has now run, and it comes back clean too: all nine ranges span u 0..1, with v
either 0..1 or 0.52..1. **No degenerate texture coordinates exist**, so the "constant V" reading was
wrong as well.

**Controlled A/B, and the contradiction is resolved.** Rather than keep inferring from single
composited frames, the sky pass was disabled and re-enabled with everything else held fixed — same
camera, same day fraction — and the two captures differenced:

| Sample        | Sky disabled    | Sky enabled     |
| ------------- | --------------- | --------------- |
| wedge left    | (220, 200, 195) | (253, 250, 217) |
| wedge right   | (220, 200, 195) | (251, 252, 206) |
| sky centre    | (220, 200, 195) | (92, 109, 153)  |
| below horizon | (220, 200, 195) | (220, 200, 195) |

The wedges change when the sky pass runs, so **the sky pass draws them**. The region below the
horizon is identical in both, so it is not sky. This is the first observation in this section taken
with exactly one variable moving, and it supersedes the inference chain above: the earlier
"drawn, not cleared" conclusion was correct, but the clear-colour comparison used to reach it was
not sound, because the reference sample's identity was never established.

**Per-range colour key: the wedges are the backdrop's side walls, and coverage is complete.**
Assigning each backdrop range a distinct flat colour keyed by its draw ordinal — carried in
`uPalettedClipMap`, which the direct-colour path does not read, so alpha, depth, blend, and object
selection were all untouched — shows the frustum fully tiled by distinct ranges. The centre wall
and the two wedges are _different ranges of the same object_, each rendering its own key colour,
with the upper and lower ranges of each wall clearly separated at the horizon.

That closes the coverage question for good: there is no gap, no missing object, and no unrasterized
region. Every pixel of the sky is drawn by an identifiable range.

**Mechanism identified: the wedge ranges sample v = 1 flat.** Decoding the colour key gives the
range-to-texture mapping — the correctly rendering centre wall is `0x050016AE`, the two wedges are
`0x050016B1` and `0x050016AD`. Reading those decoded surfaces row by row:

| Texture      | Drawn by    | Brightest row (127) |
| ------------ | ----------- | ------------------- |
| `0x050016AE` | centre wall | (158, 167, 132)     |
| `0x050016B1` | right wedge | (205, 215, 169)     |
| `0x050016AD` | left wedge  | (246, 250, 189)     |

The rendered wedge measures (253, 253, 208). That is `0x050016AD`'s **final row**, so those ranges
are sampling v ≈ 1.0 uniformly rather than traversing their gradient — every one of these textures
runs dark blue at row 0 to bright at row 127, and the wedges show only the bright end. The centre
wall reads correctly not because it is sampled differently but because its texture's final row is
far dimmer, which would make the same fault much harder to notice there.

That fully explains the symptom. What it does not yet settle is _why_ v pins to one: either those
ranges receive a degenerate interpolated v despite their authored span being 0..1, or the geometry
they belong to is a near-horizontal cap of the backdrop box seen edge-on, where a narrow v band
legitimately fills a large screen area. The box spans y −500.8 to 1050.8 at radius 1050.8, so it has
horizontal caps as well as vertical walls, and a cap viewed from inside at a grazing angle would
produce exactly this silhouette.

That check has run, and it removes the benign explanation. Reading decoded vertex positions
alongside texture coordinates for all nine backdrop ranges:

| Range | Indices | y-span | v span    | Shape          |
| ----- | ------- | ------ | --------- | -------------- |
| 0     | 0+12    | 500.8  | 0.52-1.00 | vertical wall  |
| 1     | 12+12   | 500.8  | 0.52-1.00 | vertical wall  |
| 2     | 24+12   | 500.8  | 0.52-1.00 | vertical wall  |
| 3     | 36+6    | 0.0    | 0.00-1.00 | horizontal cap |
| 4     | 42+12   | 1050.8 | 0.00-1.00 | vertical wall  |
| 5     | 54+12   | 1050.8 | 0.00-1.00 | vertical wall  |
| 6     | 66+6    | 1050.8 | 0.00-1.00 | vertical wall  |
| 7     | 72+6    | 0.0    | 0.00-1.00 | horizontal cap |
| 8     | 78+6    | 1050.8 | 0.00-1.00 | vertical wall  |

The wedge ranges are 0, 1, 4 and 5 — all **vertical walls** spanning 500 to 1050 units of height
with a full or half v range. A vertical wall whose v traverses its height cannot legitimately render
flat, so the grazing-angle-cap explanation is dead and this is a genuine defect. (The box does have
two horizontal caps, ranges 3 and 7, but they are not the wedges.)

**Correction: the "garbage v" mechanism is NOT established.** A v-only visualization showed dense
speckle across the wedges, which reads as v cycling many times per pixel. That inference is unsafe:
the debug output used `fract(v)`, and `fract` defeats mip selection, so any minified surface
manufactures aliasing that production sampling does not exhibit. The cloud pyramid tiles roughly
four times over its UV span and lies near edge-on at the horizon — exactly where the speckle
appeared — so the speckle is adequately explained as a debug artifact of the visualization itself.
The remaining source-of-bad-v candidate was also eliminated: `readBinarySectionSlice`
(binary-source-record.ts:91) **copies** its bytes and rejects non-finite f32 values, so the decoded
texture coordinates are an owned, validated array, not a view that could be detached or reused.

**What is actually established, and rests on no debug shader:**

- The range-to-texture mapping, from the colour-key capture: the correctly rendering centre wall
  draws `0x050016AE`; the two wedges draw `0x050016B1` and `0x050016AD`.
- The frustum is fully tiled by identifiable draw ranges — no gap, no missing object.
- The wedges are drawn by the sky pass, from a controlled enable/disable A/B difference.
- The wedge ranges are vertical walls, not horizontal caps.
- The production wedge colour (253, 253, 208) matches `0x050016AD`'s final row (246, 250, 189),
  measured from decoded surface bytes against an unmodified production capture. **The wedges sample
  at or near their texture's last row.** Why, is open.

**Confirmed in production, with no shader modification: some walls render flat.** A capture at
camera yaw 45 puts the box corner in view. The right wall renders a correct vertical gradient with
horizon glow; the left wall renders **uniform** — one flat olive tone above the horizon and one flat
blue below, corresponding to its upper and lower wall ranges. Because this is an unmodified
production capture, the flatness is real and not an artifact of any diagnostic.

**The decoded geometry is fully exonerated.** Dumping v per triangle for all 28 backdrop triangles
shows every one varying with height — the lower tier interpolates 0.523 to 1.0 across y −500.8 to 0,
the upper tier 0.0 to 1.0 across y 0 to 1050.8. There is not a single constant-v triangle. Combined
with the earlier checks (validated finite copies, correct slice offsets, length assertions that
would have thrown), the CPU-side data is correct in every respect.

So a wall whose vertices carry a varying v renders with a uniform colour. That is the whole
remaining puzzle, and it is now sharp: the fault lies between correct per-vertex attributes and the
rasterized result, for some walls but not others, in unmodified production rendering.

**Yaw sweep result: the defect is view-angle dependent, and the pass renders perfectly at some
angles.** Unmodified production captures at day fraction 0.5, pitch −10:

| Camera yaw | Result                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------ |
| 0          | wedges at both frustum edges                                                               |
| 45         | one wall flat, the adjoining wall a correct gradient                                       |
| **90**     | **flawless — correct gradient, horizon glow and clouds across the whole frame, no wedges** |
| 180        | wedges, as at yaw 0                                                                        |

This is the single most useful result in the investigation. It establishes that the sky pass is
fundamentally correct — resolution, residency, materials, brightness, blending, depth policy and
projection all produce a faithful sky when the camera faces a wall square-on. The defect is an
angle-dependent artifact on walls seen away from face-on, not a broken pass.

It also fits the earlier measurement rather than contradicting it: a wall seen away from face-on
renders flat at its texture's bright end, which is what the (253, 253, 208) sample showed. Since the
per-vertex v is proven correct and mip sampling was ruled out by forcing level-zero, the surviving
explanation is in how those grazing walls are rasterized or how their sample coordinates are
derived.

**Off-centre viewer eliminated.** The backdrop's vertex centroid is (0, 268, 0) and its bounding-box
centre (0, 275, 0), spanning −1050.8 to 1050.8 in both x and z. The shell is horizontally centred on
the viewer, and its walls sit at azimuths 0, 90, 180 and 270 — geometrically symmetric in azimuth.
The yaw dependence therefore cannot be explained by the viewer sitting off-centre, and the artifact
is a genuine rendering fault rather than authored geometry doing what it was told.

One structural asymmetry surfaced: the walls at azimuth 0 and 180 carry **eight triangles each**,
while those at 90 and 270 carry **four**. The wall faced at yaw 90 — the orientation that renders
flawlessly — is a four-triangle wall, and the ranges that render flat at yaw 0 sit on the
eight-triangle walls. Comparing their layouts directly, however, shows **no meaningful difference**:
the eight-triangle wall is simply split into two half-width panels (x 0 to 1050.8 and −1050.8 to 0),
each mapping u 0..1, with v varying 0.523 to 1.0 on the lower tier and 0.0 to 1.0 on the upper —
exactly as the four-triangle wall does across its full width. Both walls carry correct, varying,
identically structured texture coordinates.

**Where this ends.** Every input to those draws has now been verified correct against the shipped
record: geometry, per-triangle texture coordinates, texture content, texture keys and resource
mapping, wrap mode, material kind, brightness inputs, blend class, mip generation, buffer offsets,
array lengths, and the shell's centring on the viewer. The pass renders a fully correct sky at yaw 90. The artifact is view-angle dependent on walls seen away from face-on, and nothing in the data
distinguishes an affected wall from an unaffected one.

That exhausts what can be established without stepping into the GPU itself. The honest next move is
a frame capture in a graphics debugger (RenderDoc or the browser's WebGL inspector) on a yaw-0
frame: inspect the actual vertex attribute values fed to the flat wall's draw and the interpolated
varying at a fragment inside the flat region. That is the first measurement in this whole
investigation that would observe the pipeline rather than infer it, and every inference-based
approach available from the harness has now been tried and recorded.

**Method lesson, and the most valuable thing in this section.** Five conclusions in this
investigation were asserted and then retracted, and every retraction had the same cause: a
diagnostic that changed more than the one variable under test. Forcing alpha made invisible objects
visible. Using `fract` changed mip selection. Comparing screenshots across runs let scroll phase
move. Sampling a "clear colour" reference never established whether that pixel was clear or terrain.
Two techniques did produce first-attempt clean readings and should be preferred: a controlled A/B of
the whole pass enabled versus disabled, and keying a debug value through a uniform the active
material path ignores. Prefer measuring production captures against decoded source bytes over
modifying the shader at all.

**Fixed during verification: the sky far plane is absolute, not relative.** `SKY_FAR_PLANE = 16000`
is retail's `Render::zfar` of 4000 (acclient.c:44524) times the fourfold sky extension
(acclient.c:297400). Retail's multiplier only works because it multiplies retail's own fixed value;
our camera far is an app tuning choice, so multiplying it reproduced the ratio rather than the
distance. The authored sky geometry has fixed extent, so its far plane is a property of the content.

**Remaining:** the washed-out box-wall surfaces above, then verification across the remaining day
groups and day fractions, then Phase 3.

### Phase 3: Cleanup and wrap-up

- [x] Retire the "future sky pass" placeholder comment in `scene-environment.ts` and any remaining
      clear-color-horizon vocabulary. The placeholder went with Phase 1, when
      `ResolvedSceneEnvironment.sky` stopped being a name/index pair and became `ResolvedSkyState`.
- [x] Remove `skyHeight` from the decode schema — Phase 0 proved it write-only in retail. Dropped
      from the host projection (`lib.rs`), the zod schema (`active-region-source.ts`), and four test
      fixtures. No decoded-and-dropped fields survive this plan in the sky domain.
- [x] Delete the temporary `sky_census.rs` debug bin. Its findings are recorded in this plan; the
      shipped sky record is now the durable projection of the same data.
- [x] Record the physics-script attachment seam (`default_pes_object_id`) for the effects roadmap,
      in `docs/lighting.md` under "Physics-script seam". The roadmap already carries the
      counterpart note; both now name `0x02000714` as the celestial (not merely weather) consumer.
- [x] Update architecture/protocol docs with the sky model and Phase 0 findings —
      `docs/lighting.md` gains a "The Sky" section covering the subsystem boundary, position and
      orientation math, replacement keying, brightness (including the clamp requirement), draw
      policy, texture velocity, and the script seam, each with decompile line references.

## Risks & Mitigations

- **Guessed frame math** — a sky dome that is subtly wrong reads as "off" without an obvious
  cause. Mitigation: Phase 0 is blocking; acceptance requires formulas with line references.
- **Far-plane interaction with the portal/projection pipeline** — `zfar * 4` must not disturb
  world-pass projection or portal clipping. Mitigation: sky pass owns its own projection
  matrix; world pass state is untouched, verified by existing portal tests.
- **Draw-order coupling to the clear path** — the current renderer clears to fog/background
  color in two places (`webgl2-renderer.ts:548`, `:811`); the sky pass replaces that visual role
  without breaking the no-sky fallback (regions or day groups without sky objects must still
  clear sanely).

## Definition of Done

- [x] All three phases' task lists complete; every Phase 2 acceptance criterion met. The one
      remaining visual artifact — a view-angle-dependent flat-shading of backdrop walls — was
      reviewed in the running Explorer and **accepted rather than fixed**; its cause is unknown and
      its reproduction is recorded in Phase 2 for whoever needs it.
- [x] Frontend unit tests (667), lint, knip, formatting, type-check and clippy all clean. Rust was
      touched — a new sky source record and the `ObjectResourceClosure` split — and is covered by
      the existing host tests plus a byte-identical record comparison across the refactor.
- [x] Sky visually verified across four day fractions spanning the full cycle, four camera yaws, and
      both the Sunny and Rainy day groups, at production content. The harness gained a
      `--day-group` option for this; before it existed every capture silently used group 0.
- [x] No decoded-but-unconsumed sky fields remain **by accident**. `skyHeight` is deleted from the
      host projection and decode schema. Three resolved values are carried deliberately, each with a
      named future consumer rather than a shrug: `default_pes_object_id` and the raw `properties`
      bits await the authored-effects and weather runtimes (documented in `docs/lighting.md`), and
      `ResolvedSkyMaterial.diffuse` — the authored `max_bright` — awaits a lit sky (see Debt).

## Debt

- `ResolvedSkyMaterial.diffuse` (authored `max_bright`) is resolved but unread, and the reason is
  **conditional rather than settled**. Retail does apply it: `RenderDeviceD3D::SetCurrentMaterial`
  (acclient.c:437145) pushes `d3d_material` to the device and switches the fixed-function diffuse
  and ambient colour sources to `FromMaterial`, so `max_bright` reaches `d3d_material.Diffuse` as a
  real input. In D3D9 fixed-function that term contributes only where a light illuminates the
  surface — the ambient term uses `d3d_material.Ambient`, which `CPhysicsPart::SetLighting` never
  writes and which stays at the constructor's 1.0. **Whether the sky pass receives lights has not
  been proven.** Ignoring `max_bright` is correct only if it does not. Supporting but circumstantial:
  the sky's two cells are synthetic and author no lights, and the rendered result matches review
  across every day group and time. If the sky ever turns out to be lit, this field becomes live and
  this is the note to start from.
- The sky is not a named renderer profiling phase, so its cost is only visible inside `otherMs`
  (measured at 0.082 ms/frame). Add a `sky` CPU/GPU phase when the pass next needs attention.
- The backdrop flat-wall artifact is accepted-not-fixed; reproduction recorded in Phase 2.
- Correction from the 2026-08-06 effects-evidence probe: "every authored sky rate is constant" is
  true per day group but not across groups — the overcast sheet `0x01004C35` authors
  `(0.005, −0.0073)` in Cloudy groups and `(0.013, −0.013)` in Rainy groups. Day groups are
  exclusive, so the derived-phase model stays sound while a group is active; the divergence from
  retail is a one-frame phase-origin snap on that sheet at day-group rollover (retail's
  accumulator is continuous across the rate swap). Accepted; recorded in the effects plan's
  Measured Workload alongside the script-rate audit.

## Open Questions

- ~~Whether sky objects should render through the existing object program or a minimal dedicated
  sky program.~~ Resolved 2026-08-05: dedicated sky program — the object program's lighting
  roles, fog, and per-material depth state are all machinery the sky must neutralize (Phase 2).
- ~~Whether the environment-override fog interaction needs a hook point now or lands entirely with
  the (network-gated) override work.~~ Resolved 2026-08-06: **entirely with the override work; no
  hook point now.** `LScape::m_override_enabled` and its ambient/fog companions are written from
  exactly one place, `CPlayerSystem::Handle_Admin__Environs` (acclient.c:379135), a server/admin
  message handler taking an enumerated `environs_option` — 0 clears the override, 1 and up preset
  ambient level, ambient colour, and fog min/max/colour. Nothing in landblock or region content sets
  it, so areas that render a distinctive sky (the graveyard near `0x482E`, for instance) get it
  because the server switches environs on entry, and it cannot be reproduced from content alone.

  **The wire format is trivial and the seams are mostly in place.** ACE sends
  `GameMessageAdminEnvirons` (opcode `AdminEnvirons`, `UIQueue`) whose entire payload is one `uint`
  `EnvironChangeType`: `0x00` Clear, `0x01`-`0x06` the fog presets, `0x65`+ ambient sounds
  (`IsFog` / `IsSound` split the range). Server-side it is landblock-scoped rather than scripted per
  player — `LandblockManager.SetGlobalFogColor` sets a global and calls `SendCurrentEnviron` on each
  loaded landblock — so a future world runtime can hold it as ordinary landblock state. Our
  `opcodes.rs` already names `AdminEnvirons = 0xEA60`, commented out.

  Frontend readiness, honestly assessed:

  - **Ready.** `resolveSceneEnvironment` is a pure `(region, selection) -> ResolvedSceneEnvironment`
    and the renderer consumes only the resolved value through `setSceneEnvironment`, so it is
    already indifferent to where the environment came from. Overridden ambient and fog resolve
    through the existing `lighting`, `backgroundColor` and `distanceFog` fields with no new shape.
  - **One field short.** Nothing on the contract records _that an override is active_, which the sky
    needs independently of the resolved colours: `properties` bit 2 means _hide this object while an
    override is active with fog on_, and twenty shipped objects set it, one per day group. The bit
    itself already rides through `ResolvedSkyObject.properties`; only the active-override fact is
    missing.
  - **A real cost, and it is this plan's doing.** The sky program was deliberately built without fog
    — no uniforms, no fog chunk — because `GameSky::Draw` forces fog off. But it forces fog off
    _except_ under an override (acclient.c:297398), which is exactly the case that will need it. So
    enabling override fog is not a uniform flip; it means adding fog to the sky program. That was a
    reasonable simplification for a pass that could not otherwise reach the case, but it is deferred
    work rather than free.

- ~~**Blocking Phase 2: does the sky program share the object program's material sampler?**~~
  Resolved 2026-08-06: **no sharing, and no extraction.** The question rested on an unverified
  premise — that the sky needed the object fragment shader's full sampler. It does not. Two of the
  three expensive pieces evaporate once the sky owns standalone textures: atlas pixel-rect
  addressing and virtual-repeat `textureGrad` sampling both exist to serve atlas pages the sky no
  longer uses. The third, detail tiling, was never reachable at all — `prepareObjectVisualTemplate`
  hardcodes `detailRole: null` (object-visual-template-repository.ts:590), so no object prepared
  through that path has ever had a detail texture; detail is a `StaticDetailRole` concept belonging
  to terrain and static scenery. What genuinely overlaps is the ~25-line indexed-palette decode for
  3 of 28 surfaces. That is below the threshold where sharing beats duplication, so **the world's
  object shader is not touched by this plan.** The original framing below is retained because it
  records a real near-miss: the recommendation was to edit the shader that draws every object in the
  scene, on the strength of a feature list nobody had checked against the sky's actual materials.

  <details><summary>Superseded framing</summary>

  The
  2026-08-05 resolution ("dedicated sky program") was argued against the object program's _lighting
  roles, fog, and per-material depth state_ — all correctly unwanted. But the object fragment shader
  also carries ~150 lines of material sampling the sky genuinely needs: atlas pixel-rect
  addressing, repeat-vs-clamp source UVs, indexed-palette decode with clip-map handling, detail
  tiling, and alpha test. Three ways forward:
  1. **Extract the sampler into a shared GLSL chunk** (`WEBGL2_OBJECT_MATERIAL_GLSL`), alongside the
     existing `WEBGL2_DISTANCE_FOG_GLSL` and `WEBGL2_SCENE_LIGHTING_GLSL` composition the file
     already uses, and include it from both programs. DRY, and keeps the dedicated-program
     decision intact. Cost: it edits the shader that draws every object in the scene, so the
     regression surface is the whole world, not just the sky.
  2. **Duplicate the sampler into the sky program.** Zero risk to the world pass; ~150 lines of
     GLSL that must then be kept in sync by hand. Directly against the DRY standard.
  3. **Reuse the object program** with sky-specific uniform values (fog off, neutral lighting,
     luminosity/diffuse driven from the resolved material). Smallest diff; revisits the resolved
     open question and threads "ignore yourself" state through the general path, which is what the
     2026-08-05 resolution rejected.

  Option 1 is the recommendation, but it changes a shared shader outside this plan's scope, so it
  wants explicit sign-off before execution.

  </details>
