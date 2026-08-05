# Holtburger 3D Sky Pass Plan

Status: Unblocked — the prerequisite
[holtburger-3d-scene-lighting-plan.md](holtburger-3d-scene-lighting-plan.md) completed
2026-08-04, and the Phase 0 evidence pass completed 2026-08-03. Phases 1-3 are ready to
execute when authorized.
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
  (replaced values: gfx object, rotate, transparent, luminosity, max_bright; matched by list
  index per the Phase 0 findings, not by the authored `object_index` field).
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
  `Frame::set_heading` (degrees, Y-forward), then pitch via `Frame::grotate` about the local Y
  axis by `-deg2rad(rotation)`. It never writes an origin. Celestial (non-weather) objects sit at
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
  pair only when both sides author a positive value (transparent: `>= 0`); `pes_id`, `rotation`,
  `tex_velocity`, and `properties` are never replaced.
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
- Resolution re-runs on the lighting plan's tick cadence (3 s sky tick vs 20 s light tick as per
  retail; both derive from the same clock).

Acceptance criteria:

- Unit tests: window selection, angle interpolation, replacement application, unit scaling —
  against runtime constants, validated against the Phase 0 dump values from the lighting plan's
  region data census.

Tasks:

- [ ] `ResolvedSkyState` type and resolver.
- [ ] Replacement and windowing logic.
- [ ] Tick integration with the shared time source.
- [ ] Resolver unit tests.

Decisions and course corrections: _(fill during execution)_

### Phase 2: Sky render pass

Architecture: a dedicated sky module (retail-shaped, mirroring `GameSky`) sitting between
environment resolution and the raw renderer. The environment layer resolves; the sky module owns
every piece of sky-specific runtime state; a dedicated program draws. Concretely, the module
owns:

- The sky's GPU resources, loaded eagerly at region load. The census proves the resource set is
  closed and tiny (~21 unique gfx ids across all 20 day groups), so on-demand machinery is
  unwarranted and eager residency eliminates pop-in on day-group rollover or slider scrubbing.
  Decode and atlas residency still go through the existing object/surface resource path — only
  the load policy (everything, up front) is sky-specific.
- Pass submission under retail policy: own far-extended projection, depth test always /
  depth-write off, no fog.

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
- A dedicated sky shader program: transform, texture sample plus UV offset, luminosity/diffuse
  scalars, alpha from translucency. The object program is not reused for sky draws — it is built
  around lighting roles, fog, and per-material depth state that the sky must neutralize (retail
  suppresses the same machinery with its `m_currentlyDrawingSky` device flag), and threading
  ignore-yourself flags through the general path would raise complexity in both programs.
- Sky object geometry/material loading through the existing object resource path. Most sky
  objects are ordinary `GfxObj`s, but the census found Setup-family ids in celestial scope
  (`0x02000714` in every day group) — pin how `GameSky::MakeObject` consumes a Setup id before
  implementing, and load whichever part set that implies.
- UV scrolling from `tex_velocity` as derived phase from the shared clock (see the module's
  state note above).

Acceptance criteria:

- Sun/moon/clouds render and move when scrubbing the time-of-day slider; objects appear/disappear
  at authored windows; replacements visibly swap (e.g., night sky variants).
- Horizon no longer terminates in flat clear color outdoors.
- Sky draws are excluded from fog and never occlude world geometry.
- Frame-profiler cost of the pass recorded; no regression to world pass timings.

Tasks:

- [ ] Sky module skeleton: resource ownership, eager region-load policy, `ResolvedSkyState`
      consumption.
- [ ] Dedicated sky shader program.
- [ ] Pass ordering, depth/fog policy, far-plane handling.
- [ ] Setup-family sky object handling (pin `MakeObject` semantics first).
- [ ] UV scroll derived phase.
- [ ] Visual verification across day groups and day fractions.

Decisions and course corrections: _(fill during execution)_

### Phase 3: Cleanup and wrap-up

- Retire the "future sky pass" placeholder comment in `scene-environment.ts` and any remaining
  clear-color-horizon vocabulary.
- Remove `skyHeight` from the decode schema — Phase 0 proved it write-only in retail. No
  decoded-and-dropped fields survive this plan in the sky domain.
- Record the physics-script attachment seam (`default_pes_object_id`) for the effects roadmap.
- Update architecture/protocol docs with the sky model and Phase 0 findings.

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

- [ ] All phases complete; acceptance criteria met.
- [ ] Frontend unit tests, lint, formatting clean; no clippy impact (Rust untouched unless the
      contract needs a field, in which case tests cover it).
- [ ] Sky visually verified against retail expectations across several day groups (including at
      least one from each authored weather name) and several day fractions per group. (The
      production content ships one RegionDesc, so multi-region verification is not possible.)
- [ ] No decoded-but-unconsumed sky fields remain; deferred seams documented.

## Open Questions

- ~~Whether sky objects should render through the existing object program or a minimal dedicated
  sky program.~~ Resolved 2026-08-05: dedicated sky program — the object program's lighting
  roles, fog, and per-material depth state are all machinery the sky must neutralize (Phase 2).
- Whether the environment-override fog interaction needs a hook point now or lands entirely with
  the (network-gated) override work.
