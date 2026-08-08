# Holtburger 3D Weather and Sky-Script Runtime Plan

Status: Complete 2026-08-08 — Phase R ran 2026-08-06 with a clean verdict, Phase 0 evidence
completed 2026-08-07, the identity decision was ratified 2026-08-08 (option 3), and Phases 1
through 4 completed 2026-08-08. Two scope boundaries were deliberately widened along the way, both
because authored weather was the first content to reach a gap: the particle runtime's
untextured-material handling (Phase 3) and the sky pass's surface-brightness model (Phase 4).
Carried debt is listed under "Known Gaps at Close".
Created: 2026-08-06
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md` (parallel track)
Prerequisites:

- `docs/plans/holtburger-3d-sky-pass-plan.md` (complete 2026-08-06)
- `docs/plans/holtburger-3d-static-authored-effects-runtime-plan.md` (complete 2026-08-07)

## Authoring Provenance

The roadmap originally scheduled this plan to be authored at the effects-plan boundary. It is
authored ahead of that boundary so the deferral of sky/weather scripts out of the effects plan has
a named, scheduled owner rather than an implicit promise. The cost of authoring early is that the
PES execution, particle, and audio contracts this plan consumes do not exist yet, so:

- Phase 0 (evidence) may execute at any time; it reads only DAT content and the retail decompile.
- Every later phase is gated on the mandatory boundary dry-run recorded as Phase R, which runs
  when the effects plan completes and rewrites the implementation phases against the contracts
  that actually landed. Until Phase R runs, the implementation phases are direction, not
  commitments.

## Context and Boundaries

### Goal

Render authored weather (the Rainy day groups' rain sheets and script-driven emitters) and execute
sky-object physics scripts — including the always-visible celestial script — on the effects
runtime's landed script, particle, and audio systems.

### Problem Statement

The sky pass renders celestial objects but deliberately excludes the 92 authored weather objects
and never executes any sky object's `default_pes_object_id`. The effects plan executes physics
scripts only for authored landblock residents; sky objects are sky-module-owned and
viewer-centered, a second script-target ownership it explicitly declined to pre-build. The result
is two recorded seams with no owner: rainy day groups render their celestial set but no rain, and
96 sky objects carry script ids that nothing runs. This plan is that owner.

### In Scope

- Viewer-pinned weather object placement and rendering: the scrolling rain sheets (GfxObjs
  `0x01004C42` / `0x01004C44`) with retail's XY-pin and z-clamp semantics (`properties` bits 4/8).
- The after-landscape draw pass for `properties` bit 1 objects, drawn only outdoors with weather
  enabled.
- A weather-enabled policy switch mirroring retail's `weather_enabled`, including retail's
  recreate-on-toggle behavior, surfaced as an explorer control.
- Extending the effects runtime's script-target port to sky-module-owned objects.
- Executing the four censused sky physics scripts through the landed effects consumers: celestial
  `0x330007DB` (on `0x02000714`, every day group) and weather-emitter scripts `0x33000428` /
  `0x3300042C` / `0x33000453` (on Setups `0x02000588` / `0x02000589` / `0x02000BA6`).
- Particles and audio emitted by those scripts, through the effects plan's particle and audio
  runtimes.

### Out of Scope

- Environment overrides (`properties` bit 2, fog-on-override in the sky program): server-driven
  via `AdminEnvirons`, unreachable from content alone (proven in the sky pass plan's open-question
  resolution). They enter with network-gated override work, which also pays the sky-program fog
  cost recorded there.
- Weather occurrence policy beyond authored day groups: retail has none; rainy-group chance
  selection already exists in day-group hashing.
- Any change to the effects runtime's authored-resident target ownership, script scheduling,
  particle, or audio internals. This plan is a consumer; if a contract does not fit, Phase R
  renegotiates it with evidence rather than forking it. **Widened twice on 2026-08-08**, both by
  explicit user decision and both because authored weather content was the first to reach a gap:
  untextured particle materials (Phase 3), and the sky pass's surface-brightness model (Phase 4).
- New sky schema fields. The sky pass carries `default_pes_object_id` and raw `properties`
  losslessly end to end already; a schema change here means one of these plans got its contract
  wrong.
- Generic precipitation, wind, or climate simulation. The deliverable is the authored content,
  nothing more.

## Ground Truth and Existing Precedent

### Authoritative References

- `acclient-eor-source/acclient.c`
  - `GameSky::UpdatePosition` (acclient.c:297298-297341): weather objects pin to the viewer's XY
    with z forced to −120.0 unless `properties` bit 8 is set.
  - `GameSky::CreateDeletePhysicsObjects` / the after-sky-cell: bit 1 objects draw as a whole cell
    after the landscape, only outdoors with weather enabled; toggling weather forces recreation.
  - `GameSky::MakeObject` (call site acclient.c:297707-297714): consumes
    `default_gfx_object_id`, `tex_velocity`, and `properties`; `default_pes_object_id` is the
    script attachment.
  - Complete `properties` bit semantics: pinned in the sky pass plan's Phase 0 findings
    (bits 1/2/4/8; no others exist).
- `ACE/Source/ACE.DatLoader` for the four physics scripts' decoded shapes (Phase 0 decodes them).
- The sky pass plan's 2026-08-05 census: 92 weather objects confined to the 8 Rainy day groups;
  96 sky objects with `default_pes_object_id`; `properties` histogram `{0: 120, 2: 20, 4: 8,
5: 8, 13: 76}`.

### Existing Code to Extend

- `apps/holtburger-3d/src/lib/game/environment/sky-state.ts`: `ResolvedSkyObject` already carries
  `properties` and the PES id losslessly; the resolver keeps weather objects and marks them,
  leaving nothing to re-derive. (Phase 1 replaced the `isCelestial` flag this originally named with
  the richer `SkyPlacement` composite.)
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-sky-pass.ts`: celestial residency and draw
  policy. The derived-phase scroll arithmetic the rain sheets' `tex_velocity` (up to
  `(0.02, -2.0)`) also uses now lives in the shared `textureScrollPhase`
  (`renderer/texture-scroll-phase.ts`), hoisted there by the effects plan.
- `apps/holtburger-3d/src-tauri/src/sky_source.rs`: the sky record's closure machinery
  (`ObjectResourceClosure`) already dispatches both GfxObj and Setup families, but
  `celestial_source_ids` deliberately excludes bit-4 weather objects (`sky_source.rs:57`) —
  Phase 1 widens that selection (a Phase 0 corrective finding; the original claim here that
  weather ids already rode the closure was wrong).
- The effects plan's landed systems, named only after they exist: `PhysicsScriptSystem`,
  `BehaviorEventRouter`, the particle runtime, and the audio runtime. Phase R binds this plan to
  their real shapes.

## North Stars

1. Weather is authored content on proven systems — no new script, particle, or audio machinery;
   this plan adds targets and placement, not engines.
2. Retail's weather mechanics are the spec: XY pin, z clamp, after-landscape pass, outdoors-only,
   recreate-on-toggle. Modernizing any of them is a recorded decision, not a default.
3. The sky schema stays closed. Both upstream plans carried these fields losslessly so this plan
   would need no schema change; honoring that is the proof the seam was designed correctly.
4. The script runtime gains one honest second target ownership, shaped by what sky targets
   actually need — not a speculative general target abstraction.
5. Explorer weather controls are app-local policy; authored weather semantics are shared.

## Phased Implementation

### Phase 0: Evidence

Progress: **Complete 2026-08-07.** Script decode landed 2026-08-06; the retail draw-policy,
`weather_enabled`, pass-ordering, and closure findings below landed 2026-08-07 from the decompile
and a temporary `weather_asset_probe` (removed after recording).

#### Deliverables

- ~~Decode all four sky physics scripts (`0x330007DB`, `0x33000428`, `0x3300042C`, `0x33000453`)
  and their transitive `CallPES` closures; record every event type, count, and referenced asset,
  in the effects plan's evidence format.~~ Done 2026-08-06 by the shared evidence probe:

  | Script       | Closure | Contents                                                                                                                     |
  | ------------ | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
  | `0x330007DB` | 1       | Three `CreateParticle` at `t=0`, `part=-1` (root), emitters `0x32000455`-`0x32000457`                                        |
  | `0x33000428` | 2       | Rain-sound loop: `SoundTweaked 0x0A00038B` vol 0.35, mutual `CallPES` with `0x33000429` every 2.8 s                          |
  | `0x3300042C` | 2       | Same loop at vol 0.1, mutual `CallPES` with `0x3300042D`                                                                     |
  | `0x33000453` | 1       | Self-`CallPES` with `pause=30`; `CreateParticle` emitter `0x320002C2` part 0; seven timed `SoundTweaked` (`0x0A0004D0`-`D2`) |

  The vocabulary is exactly `CreateParticle`, `SoundTweaked`, and `CallPES` — fully inside the
  effects plan's committed consumers; no sky script needs a hook family that plan does not build.
  The probe also proved every sky `default_pes_object_id` equals the referenced Setup's own
  `default_script`, so these scripts are ordinary members of the effects plan's setup-default
  census; only their _target ownership_ (sky-module-owned, viewer-centered) is new here.

- ~~Pin the rain sheets' full draw policy from retail: blend flags, depth behavior in the
  after-landscape pass, and how the z-clamped sheet interacts with terrain depth.~~ Done
  2026-08-07:

  - Both sheets (`0x01004C42`, `0x01004C44`) are 8-polygon GfxObjs sharing one surface
    `0x080000C5`: type `0x00010112` = `BASE1_IMAGE | TRANSLUCENT | ALPHA | ADDITIVE`, authored
    translucency 0.5, luminosity 0.148, texture `0x05001A26` → `0x06004002`. No weather-specific
    blend state exists anywhere — the shared `objectBlendPolicy` mapping applies unchanged.
  - `GameSky::Draw` (acclient.c:297381-297437) wraps **both** sky passes in one state block:
    fog forced to `LScape::m_override_enabled`, `zfar × 4`, `DEPTHTEST_ALWAYS` with depth writes
    **off**, and `m_currentlyDrawingSky = 1`; on exit it restores `DEPTHTEST_LESSEQUAL`/write-on.
  - While `m_currentlyDrawingSky` is set, `D3DPolyRender` **bypasses alpha-list deferral**
    (acclient.c:434811-434814) and **skips per-surface depth-mode changes**
    (acclient.c:434175-434176), so the translucent sheets draw immediately under the sky depth
    state; FF lighting is forced on (acclient.c:434299), and the `ADDITIVE` bit disables fog
    alpha (acclient.c:434177-434186).
  - Consequence: **the z-clamped sheet never interacts with terrain depth at all.** Rain draws
    over everything rendered before it; only later draws (portal-visible EnvCells, the post-
    `LScape::draw` alpha flush) cover it. The z = −120 clamp shapes the sheet's geometry, not its
    occlusion.

- ~~Pin `weather_enabled` semantics: where retail stores it, what toggling destroys and recreates,
  and whether any state survives a toggle.~~ Done 2026-08-07:

  - `LScape::weather_enabled` is a static bool defaulting to `true` (acclient.c:44269), written
    only by `SmartBox::EnableWeather` (acclient.c:137097), which is driven by the **character
    option** `PlayerModule::DisableMostWeatherEffects` at login and on options change
    (acclient.c:432565, 432696). Our explorer toggle mirrors a retail player option, not a debug
    flag.
  - Complete reader census: `GameSky::MakeObject`'s creation gate (acclient.c:297347),
    `GameSky::Draw`'s per-object weather skip in the before pass (acclient.c:297418),
    `LScape::draw`'s after-pass gate (acclient.c:296725), and toggle detection against the shadow
    copy `GameSky::s_weatherEnabled` in `CreateDeletePhysicsObjects` (acclient.c:297617-297618).
    Nothing else reads it.
  - Toggle semantics (`GameSky::CreateDeletePhysicsObjects`, acclient.c:297587): an existing
    object is reused only when its gfx id and properties match **and** weather did not toggle or
    the object is not bit-4. On toggle, every bit-4 object is destroyed and re-made through
    `MakeObject`, which returns null while weather is disabled. **Celestial objects survive
    toggles untouched**; recreation happens on the next sky tick via `UseTime → GetSky →
CreateDeletePhysicsObjects` (acclient.c:297744-297746).

- ~~Pin the after-cell pass ordering precisely: what "drawn after the landscape" means relative to
  our world pass, transparency ordering, and portal compositing.~~ Done 2026-08-07:

  - Outdoor frame order (`PView::DrawCells`, acclient.c:441068): `LScape::draw` →
    `D3DPolyRender::FlushAlphaList` → portal-visible EnvCells.
  - Inside `LScape::draw` (acclient.c:296701-296729): `GameSky::Draw(0)` (celestial plus the
    **8 `properties = 4` sheets**, which draw in the _before_ pass) → the landblock draw loop →
    `GameSky::Draw(1)` when `weather_enabled`, which draws the whole `after_sky_cell` in one cell
    draw. The 84 bit-1 objects (`properties` 5/13) live in that dedicated `after_sky_cell`;
    everything else lives in `before_sky_cell` (`MakeObject`, acclient.c:297357-297363).
  - The after pass additionally requires `SmartBox::is_player_outside` inside `Draw`
    (acclient.c:297393); the before pass has no outdoor gate of its own.
  - Deferred translucent world polys flush **after** the after pass, and portal-visible interiors
    draw later still — both legitimately cover rain.

- ~~Verify the weather GfxObjs and emitter Setups resolve through the existing sky record closure
  with no missing dependencies.~~ Done 2026-08-07, **with a corrective finding**: they do _not_
  ride the closure today — `celestial_source_ids` deliberately skips bit-4 objects
  (`sky_source.rs:57`), so this plan's "Existing Code to Extend" claim was wrong and Phase 1 must
  widen the closure. The widening is mechanical: `ObjectResourceClosure::add_resident` already
  dispatches both `0x01` GfxObj and `0x02` Setup families. The probe confirmed all four script
  Setups decode cleanly and share one shape — a single part `0x010001EC` carrying only
  `default_script` (no animation, motion table, sound table, or script table): they are pure
  script carriers, and the rain sheets decode with a fully-resolvable material graph.

- Additional placement facts pinned along the way (`GameSky::UpdatePosition`,
  acclient.c:297298-297341; `GameSky::UseTime`, acclient.c:297724): a bit-4 object's origin is set
  to the **viewer's full XYZ** each position update, then z is forced to −120 unless bit 8 — so
  bit-8 weather objects (the `properties = 13` majority) track the viewer's z rather than keeping
  an authored height. On each sky tick, `UseTime` rebuilds frames from heading/rotation; bit-4
  objects inherit the current pinned origin rather than resetting.

#### Acceptance Criteria

- Every implementation phase cites exact asset ids, decoded event workloads, and decompile line
  references; no formula or lifecycle rule is guessed.
- ~~The celestial script `0x330007DB`'s actual behavior is recorded.~~ Recorded 2026-08-06: it is
  pure ambient particles — three root-attached emitters started once at `t=0`, no repetition, no
  sound. Phase 2's verification is therefore visual (three attributable emitters on
  `0x02000714`), and the emitter-info assets `0x32000455`-`0x32000457` are the fixtures.

#### Decisions and Course Corrections

- **Retail never reads `default_pes_object_id` at all** (2026-08-07). `GameSky::MakeObject`
  passes only the gfx/setup id to `CPhysicsObj::makeObject`; the script plays because setup
  initialization itself runs `play_script_internal` on the setup's `default_script`
  (`CPhysicsObj::InitDefaults`, acclient.c:514489-514504). This confirms the 2026-08-06 census
  finding (`default_pes_object_id` equals the setup's own `default_script` everywhere) from the
  consuming side: the region field is authoring redundancy, and our activation path should key on
  the setup's default script exactly as the effects runtime already does for authored residents.
- **The sky-closure claim in "Existing Code to Extend" was wrong and is corrected there.**
  Weather objects are resolved and carried through the frontend contract, but their resources are
  deliberately excluded from the sky source record; widening `celestial_source_ids` is a named
  Phase 1 deliverable rather than an assumed given.
- **Open question 3 is closed against modernization.** Retail's rain sheets draw depth-always
  with no depth writes; a depth-tested world-pass draw would let terrain occlude rain and cannot
  reproduce retail. The after-landscape pass (or an observably equivalent ordering) is required
  for correctness, not just for the outdoors-only gate.

### Phase R: Boundary Dry-Run (mandatory gate)

Progress: **Run 2026-08-06**, when the effects plan completed. Verdict: **the landed shape hosts sky
targets as an extension, not a redesign** — with exactly one identity decision to make first.

#### What landed, and what it means for this plan

| Contract          | Landed shape                                                                            | Fit for sky targets |
| ----------------- | --------------------------------------------------------------------------------------- | ------------------- |
| Command union     | `PreparedBehaviorCommand`, producer-agnostic, provenance carried beside it              | Direct reuse        |
| Script clock      | `PhysicsScriptSystem`, wall-clock, per-target, drift-free chaining                      | Direct reuse        |
| Dispatch          | `BehaviorEventRouter`, owns nothing, one recorded outcome per command                   | Direct reuse        |
| Particle consumer | `ParticleSystem`, **all dependencies injected** (`originOf`, `resolveEmitter`, `clock`) | Direct reuse        |
| Audio consumer    | `AudioSystem`, position supplied per trigger                                            | Direct reuse        |
| Staging           | Closure + emitters + sound table + meshes, all before activation                        | Direct reuse        |

The consumers are injection-shaped, which is what makes this an extension: sky objects supply their
own origin resolver and liveness predicate without any consumer learning what a sky object is.

#### The one open decision: what a sky `BehaviorTarget` is — RATIFIED 2026-08-08: option 3

`BehaviorTarget` is `{ nodeId: SceneNodeId; generation: number }`. Sky objects are viewer-centered
and sky-module-owned; they are **not scene-graph residents today**. Three ways to close that were
considered:

1. **Give sky script owners real scene nodes.** Sky objects gain nodes whose placement is
   viewer-pinned. Everything else works unchanged, including `#sceneOriginOf` and generation-based
   liveness. Cost: the sky module acquires scene residency it currently, deliberately, does not
   have, and per-frame placement writes exist only to feed a callback that could compute the value.
2. **Widen `BehaviorTarget` to a tagged identity** (`{ kind: "scene" | "sky"; ... }`) and inject a
   resolver per kind. Cost: every consumer's origin lookup becomes a branch, and the target type
   stops being a single obvious thing.
3. **Behavior-owned target identity, residency resolved at the composition root.** `BehaviorTarget`
   keeps its exact shape — one id plus one generation, no tag — but the id becomes a
   behavior-layer brand (`BehaviorTargetId`) instead of borrowing `SceneNodeId`. The scene keeps
   minting `scene-node:${n}` ids; the sky module mints its own. `GameRuntime`'s origin/rotation
   resolvers (already private composition-root closures) become a residency lookup: scene targets
   resolve through `getResolvedPlacement` as today, sky targets through a provider registered at
   activation that computes the viewer-pinned origin **on demand from the camera**.

**Ratified: option 3** (2026-08-08, superseding Phase R's original option-1 recommendation). The
landed code makes it the honest choice:

- Liveness never consulted the scene: `isLive` is producer-held
  (`animation.holds || scripts.holds`, `game-runtime.ts:843`), so generation-safe identity needs
  no node.
- Origin is already pull-based: `ParticleSystem` polls the injected `sceneOriginOf` per frame for
  following emitters (`particle-system.ts:420,471`). Option 1's per-frame placement writes would
  push a value that is only ever pulled.
- Phase 0 proved the sky vocabulary is exactly `CreateParticle`/`SoundTweaked`/`CallPES`, so sky
  targets never reach `EffectSystem` or presentation — the only genuinely scene-node-keyed
  consumers. Their entire consumer surface (particles, audio, scheduler) is origin-injected.
- The residency lookup is a map at the composition root, not a branch inside any consumer — the
  distinction that made option 2 wrong.

Recorded costs: a mechanical rename ripples `BehaviorTarget.nodeId`/`BehaviorObservation.nodeId`
from `SceneNodeId` to the behavior-owned brand across the behavior layer (Phase 2 work); the
composition root gains one target-residency registry; sky providers must also supply rotation for
emitter frames (the object's `CalcFrame` heading/rotation). This diverges from retail's
_mechanism_ — retail really does give sky objects cell residency and pushes frames every update
(`GameSky::UpdatePosition`) — but matches its observable behavior at the same cadence, per the
app's approximate-behavior-not-architecture doctrine.

#### Course corrections for the implementation phases

- **`CallPES` pause is load-bearing, not incidental.** The measured evidence found nonzero pauses in
  shipped content, and the landed system implements retail's uniform roll. Sky scripts that repeat
  will not be in lockstep across objects, which is correct and should not be "fixed" if observed.
- **Particle meshes are already batched and cached.** Sky emitters name `hw_gfxobj_id`s exactly as
  authored residents do, so Phase 3 needs no new mesh path — only to stage its ids.
- **Do not rebuild scroll-phase arithmetic.** `textureScrollPhase` is shared and unit-tested; the
  rain sheets consume it directly.
- **The effects plan's `TextureVelocity` renderer gap does not block this plan.** Weather sheets
  scroll through the _sky_ path, which already binds `uTextureOffset`; the deferred item is the
  object-path binding.

#### Decisions and Course Corrections

- Phase R executed at the effects-plan boundary as scheduled. No contract required renegotiation;
  the single identity question above is recorded as this plan's first decision rather than a
  roadmap-level escalation.
- 2026-08-08: the identity decision was ratified as option 3 (behavior-owned target identity),
  superseding this dry-run's option-1 recommendation after composition-level evidence showed
  liveness and origin never actually depend on scene residency. See the decision block above.

### Phase 1: Weather Placement and Rendering

Progress: **Complete 2026-08-08.** All five deliverables landed and were verified in the browser
harness on the real GPU against Rainy day group 3.

#### Deliverables

- Widen `celestial_source_ids` in `sky_source.rs` to include weather objects (the Phase 0
  corrective finding): the two rain-sheet GfxObjs and the three emitter Setups project through
  the existing `ObjectResourceClosure` with no new machinery.
- Viewer-pinned placement for weather objects per retail (`GameSky::UpdatePosition`,
  acclient.c:297298-297341): the full origin follows the viewer each update, with z forced to
  −120 unless bit 8 (bit-8 objects track the viewer's z).
- Weather draw policy matching the recorded retail state block: depth-test always, depth writes
  off, no alpha-list deferral, blend from the authored surface via the shared
  `objectBlendPolicy` (the sheets are `TRANSLUCENT | ALPHA | ADDITIVE` at translucency 0.5), and
  scroll phase from the shared `textureScrollPhase`.
- Pass placement matching retail's observable order: the 8 `properties = 4` sheets draw with the
  existing before-world sky pass; the 84 bit-1 objects draw in a new after-landscape pass that
  runs after the world pass and before portal compositing, gated outdoors-only and on
  weather-enabled.
- A weather-enabled explorer control mirroring retail's player option
  (`DisableMostWeatherEffects` → `SmartBox::EnableWeather`) with recreate-on-toggle semantics:
  weather objects are destroyed/recreated on toggle, celestial state survives untouched.

#### Acceptance Criteria

- ~~Rainy day groups render scrolling rain sheets over terrain from inside the world, verified in
  the harness across camera motion; non-rainy groups and interiors render none.~~ Verified
  2026-08-08 on the real GPU: rain draws over terrain and trees from a ground-level pose in
  landblock `0xda55ffff` under day group 3, and the after pass is suppressed from inside EnvCell
  `0x7d64010e` while the before pass still runs (matching retail's asymmetric gate).
- ~~Toggling weather off and on recreates weather state without leaking residency or affecting
  celestial rendering.~~ Verified 2026-08-08 by an A/B capture at one fixed pose: `--no-weather`
  removes every streak and leaves the celestial cloud layers pixel-identical. See the
  recreate-on-toggle correction below for what this criterion does and does not yet prove.

#### Decisions and Course Corrections

- **The closure exclusion had two sites, not one.** Phase 0 named `sky_source.rs:57`; the
  `SkyObjectReplace` path at `sky_source.rs:73` applied the same bit-4 filter to a replacement's
  *target* object. Widening removed both, and the replacement path's target lookup collapsed
  entirely — with every object eligible, a replacement no longer needs to resolve which object it
  names. Net simpler than before. Verified by a temporary census probe: the closure goes from 16
  to 21 unique DAT ids, adding exactly `0x01004C42`, `0x01004C44`, `0x02000588`, `0x02000589`,
  and `0x02000BA6`, with the `properties` histogram reproducing the 2026-08-05 census exactly
  (`{0: 120, 2: 20, 4: 8, 5: 8, 13: 76}`). Rainy groups are indices 3, 7, 9, 15, 16, 17, 18, 19.
  Probe removed after recording.
- **The two rain sheets straddle the pass boundary**, which the plan had not stated:
  `0x01004C42` is `properties = 4` (before pass) and `0x01004C44` is `properties = 5` (after
  pass); both are height-clamped, and the three emitter Setups are the `properties = 13`
  viewer-tracking objects. So the before-pass sheet is occluded by terrain **by construction** —
  it draws into an untouched depth buffer and the world paints over it — and the rain a player
  actually sees is the after-pass sheet. Retail behaves identically; recorded because "the rain
  sheets" reads as one thing and is two with different visibility.
- **`isCelestial` was replaced by a `SkyPlacement` composite**, not extended. Pass selection
  (bit 1), weather gating (bit 4), and the height clamp (bit 8) are derived once in `sky-state.ts`
  and consumed as a decision, so the renderer never re-reads raw `properties`. `skyObjectOrigin`
  is the single pure function owning the viewer pin.
- **A latent sampler-completeness defect was exposed and fixed.** Moving a sky draw after the
  terrain pass produced `GL_INVALID_OPERATION: Mismatch between texture format and sampler type`
  on every weather draw. Cause: the terrain pass binds integer `usampler2D` textures to units 0
  and 1, which are the sky program's `uBase` and `uPalette`; the sky pass skipped binding the
  palette unit for a direct-color surface, so it inherited terrain's integer texture, and WebGL
  validates every statically-used sampler regardless of which branch executes. The sky pass now
  binds the palette unit unconditionally. This was unreachable while the sky only ever drew first.
- **Recreate-on-toggle is a no-op at this phase, and that is the honest outcome.** Retail destroys
  and re-makes bit-4 objects on toggle because it retains `CPhysicsObj` instances. Our weather
  rendering holds no per-object state at all: resources are region-resident and placement is
  derived per frame, so toggling is pure draw suppression and there is nothing to leak. The
  criterion above therefore verifies celestial isolation but cannot yet verify teardown. Real
  toggle teardown arrives with sky *script* state in Phase 3 — deliberately not pre-built here
  rather than standing up dormant lifecycle machinery for state that does not exist.

#### Debt

- ~~The object path carries the **same** palette/sampler hazard the sky pass just fixed.~~ Traced
  and fixed 2026-08-08. The mechanism already existed — `#beginObjectPhase()` primes every object
  sampler unit — but only the opaque pass called it, and only *after* an early return on
  `candidates.length === 0`. The blended pass called `#objectState.invalidate()` instead, which
  makes issued binds re-apply but does nothing for a bind that is *skipped*: direct colour skips the
  palette, solid colour skips both base and palette. So a view holding transparent or additive
  objects and **no opaque ones** reached the blended loop with terrain's integer `usampler2D`
  textures still on units 0 and 1, under float samplers, failing validation on every draw. The
  blended pass now primes through `#beginObjectPhase()` exactly as the opaque pass does, which also
  removes the cross-pass ordering dependency that made inserting the after-sky pass risky.

### Phase 2: Sky Script Targets

Progress: **Complete 2026-08-08.** The option-3 cutover landed, sky targets activate and tear down
by reconciliation, and the celestial script executes with the behavior Phase 0 recorded.

#### Deliverables

- The option-3 identity cutover: rebrand `BehaviorTarget.nodeId` (and `BehaviorObservation`) from
  `SceneNodeId` to a behavior-owned `BehaviorTargetId`, with the scene minting its ids unchanged
  and a target-residency lookup at the composition root replacing the direct
  `getResolvedPlacement` calls in `#sceneOriginOf`/`#sceneRotationOf`. A clean rename, not a
  parallel type.
- Sky targets registered with generation-safe identity and an on-demand viewer-pinned
  origin/rotation provider; activation on day-group entry/visibility, teardown on day-group
  rollover, weather toggle, and region unload.
- Activate the celestial `0x330007DB` on `0x02000714` in every day group.

#### Acceptance Criteria

- ~~The celestial script executes with the behavior Phase 0 recorded; unsupported commands report
  provenance, never vanish.~~ Verified 2026-08-08 against day group 0 (celestial only): one active
  sky script, `0x330007db` dispatching exactly three `create-particle` commands, three live
  emitters, nine particles, no errors — Phase 0's "three root-attached emitters started once at
  `t=0`, no repetition, no sound", reproduced exactly. Every observation carries its script id and
  authored position as provenance.
- ~~Day-group rollover and region unload tear down sky script clocks, queued activations, and
  acquired closures atomically.~~ Implemented as reconciliation with a supersession guard; see the
  correction below for what is and is not yet verified.

#### Decisions and Course Corrections

- **Activation is reconciling, not event-driven.** `SkyScriptSystem.sync` takes the resolved sky
  each tick and diffs it against what is running. That is what the sky already is — retail rebuilds
  its object set every tick and reuses an object only when its identity still matches
  (`GameSky::CreateDeletePhysicsObjects`, acclient.c:307587) — and it collapses day-group rollover,
  authored-window transitions, and the weather toggle into one mechanism instead of three
  separately detected events.
- **`ResolvedSkyObject` gained `authoredIndex`.** The resolver drops objects outside their window,
  so a resolved array index is not stable across ticks and cannot identify a running script clock.
  Target ids are `sky-object:${dayGroupIndex}:${authoredIndex}`.
- **The field renamed as well as the type.** The plan called for rebranding `BehaviorTarget.nodeId`
  to `BehaviorTargetId`; the field is now `targetId`, because "node" stops being true the moment a
  target need not be a scene resident. `BehaviorObservation` followed.
- **The scene-keyed consumers kept their `SceneNodeId` keys** rather than rekeying on the brand,
  and convert at their router-facing edge through a checked `requireSceneNodeId`. This turns the
  dry-run's stated safety argument — "Phase 0 proved the sky vocabulary never reaches
  `EffectSystem`" — from a content census into an enforced structural guarantee. The guard fired
  immediately and correctly during bring-up, which is how the next item was found.
- **`holds` is a total predicate; the command methods are not.** `AnimationSystem.holds` initially
  used the throwing guard and rejected every sky dispatch, because liveness asks *every* producer
  about *every* target. "Do you hold this?" has a legitimate "no" for a target the system could
  never hold; `applyScale` on a target it does not hold remains an error. Distinguishing the two is
  what made sky dispatch work at all.
- **Two consumers needed residency awareness that the ratified decision did not name**, both found
  by running the code rather than reading it. Neither required leaving option 3's shape — both are
  the same composition-root lookup:
  - `partFrameOf` resolved through the dynamics system, which a sky target is not in. Sky objects
    are single-part Setups, so part 0 is the object itself; any other index is `unprepared`. Phase
    3's `0x33000453` emits on part 0 and would otherwise never have created its emitter.
  - Particle cohort culling tested membership in the renderer's dynamic-node selection, which a sky
    target is absent from by construction, so every sky emitter would have culled to nothing every
    frame. Sky targets are always selected — retail never culls the sky.
- **Sky script staging needed no new record fields.** Scripts are already id-addressed through the
  `load_physics_script` command rather than bundled into a landblock record, so the sky reuses the
  existing repositories directly. The "no new sky schema fields" north star holds literally.

#### Debt

- Neither drop path is exercised by shipped content — which is the point, but it also means neither
  is covered by a test. `ParticleMeshResidency` has no test file at all and would need a mocked
  resource manager and texture preparer to get one, so a future change reintroducing a throw would
  regress silently. The drop counter in its diagnostics is the only standing signal.
- Teardown is implemented for day-group rollover, window close, weather toggle, script-id change,
  and runtime destruction, with a supersession guard that releases assets staged for an activation
  the sky has already moved past. Only the weather-toggle and steady-state paths have been
  exercised on real content; rollover and region unload are structurally the same diff but were
  not separately observed.
- ~~Sky script assets are staged lazily and evicted on every teardown.~~ Fixed 2026-08-08.
  `PreparedAssetRepository` drops a ready entry once its last handle releases, and sky scripts have
  no other owner, so releasing on teardown meant every weather toggle, day-group rollover, and
  authored window transition re-fetched the closure and emitter infos over IPC. `SkyScriptSystem`
  now retains staged assets per **script id** for its own lifetime and releases them only at
  `destroy`, matching the sky pass's eager-residency model. Teardown removes a clock and a target
  registration and nothing else. Staging is also now shared per script id rather than per target,
  which shipped content needs directly: a Rainy day group authors up to five instances of the same
  emitter Setup, and each would otherwise have staged it independently. A staging that lands after
  destroy releases itself rather than entering the retained set.

### Phase 3: Weather Emitter Scripts

Progress: **Complete 2026-08-08.** The solid-colour gap below was brought into scope by the user
and fixed; all four censused sky scripts now execute and their emitters render.

#### Deliverables

- Activate the three weather-emitter scripts on their Setup-backed sky objects; their particles
  and audio flow through the effects runtimes with viewer-pinned source transforms.

#### Acceptance Criteria

- ~~Rainy groups produce the emitters' authored particle and audio behavior, attributable per
  script; disabling weather stops and cleans them deterministically.~~ Verified 2026-08-08 on day
  group 3: all four censused scripts dispatch — `0x330007DB`, `0x3300042C`, its `CallPES` partner
  `0x3300042D`, and `0x33000453` — producing `create-particle`, `sound-tweaked`, and a scheduled
  `call-pes`, each observation carrying its own script id and authored position. `--no-weather`
  drops active sky scripts from three to one, leaving the celestial script running and reporting no
  errors.

#### Decisions and Course Corrections

- **Scope widened, by decision, for untextured particle materials.** The blocker recorded above was
  escalated and the user brought it in scope. Retail's answer settled the design: it has no
  solid-colour shading path at all, writing the colour into a 1×1 texture and taking the ordinary
  textured path (`D3DPolyRender`, acclient.c:434074; `SetSolidColorTextureColor`,
  acclient.c:437178). We did **not** copy that. Our object program already carries an authored
  colour as a uniform under reserved material kind 0, so the particle program gained the same kind
  and uniform; synthesising a one-texel texture to recover a value we already hold would be
  strictly worse. Retail's alpha rule *is* reproduced exactly: the authored colour's own alpha is
  masked off in favour of `1 - translucency`.
- **A 1×1 placeholder exists after all, for a different reason.** An untextured mesh binds it purely
  so the statically-used samplers have compatible textures — the same GL validation rule that
  produced Phase 1's sky defect, on the same units the terrain pass leaves integer textures on. It
  is never sampled and carries no colour.
- **An unsupported material now drops its own work loudly instead of throwing** (user decision,
  2026-08-08). Both sites sit inside batch preparation, so a throw took down far more than the
  asset that caused it: one untextured particle mesh failed every mesh staged alongside it, and one
  untextured sky surface would have failed the region's whole sky. Each now reports the exact
  object, part, and reason on the console and drops only itself — the sky loses one range, the
  particle runtime loses one mesh, and `ParticleMeshResidency` counts the drop in its diagnostics so
  it is visible without reading logs. This trades the house preference for failing loudly on our own
  logic errors against blast radius, on the grounds that an unsupported *authored* material is a gap
  in this renderer rather than a caller error.
- **The sky pass still does not implement untextured surfaces**, and that stays deliberate: no
  shipped sky object authors one, so building the path would be dormant infrastructure. It is a
  documented unimplemented case, not a divergence, and needs no marker.
- The escalation as first written overstated the cost: it described the fix as extending the
  particle runtime's material model, when our pipeline already modelled solid colour end to end
  (`ResolvedMaterial`, the material planner, and the object program) and only two consumers assumed
  every material was textured.

### Phase 4: Resteer, Measure, and Clean Up

Progress: **Complete 2026-08-08.**

- [x] Measure weather pass and sky-script cost; the sky pass's profiling debt (no named `sky`
      phase) is paid here if either needs attention.
- [x] Sweep any temporary probes, placeholder gates, or dead vocabulary introduced along the way.
- [x] Update `docs/lighting.md`'s sky/weather sections and close the physics-script seam note.

#### Decisions and Course Corrections

- **The sky pass's brightness model was wrong, and weather content exposed it** (scope widened by
  user decision, 2026-08-08, after a reviewer flagged rain reading as an overlay). Three separate
  defects, all in one expression:
  - `luminosity ?? 1` treated an unauthored channel as full brightness. Retail's -1 sentinel leaves
    the **surface's** own value (acclient.c:297764). The rain sheets author 0.148 and every
    day-group replacement for them is zero, so they drew ~6.8x too bright — on an `ADDITIVE`
    surface, which is why it read as rain being painted over the world.
  - The two channels were **multiplied**. Retail branches: `surface->luminosity > 0` drives
    Emissive, otherwise Ambient and Diffuse carry the surface (acclient.c:434305). Multiplying
    dimmed every emissive layer by its diffuse scale.
  - `ResolvedSkyMaterial.diffuse` — the authored `max_bright` — was decoded, carried through the
    contract, and **never read**. The sun and cloud layers author usable values of 11-100 and were
    losing them entirely.
  The full-brightness default was defended in a comment as the only thing keeping zero-luminosity
  layers such as the night stars from resolving to black. That was true *given the multiply*, and
  stops being true once the branch is correct: the else branch is exactly what lights them. An A/B
  night capture confirmed it — the night sky went from a murky brown wash to a clean deep-blue
  gradient, so the fallback had been degrading the case it existed to protect.
- **Weather opacity is now a marked divergence, by user decision** (2026-08-08). Reviewing against
  retail, the viewer-pinned columns read as distracting during camera movement — and the reviewer
  noted they are erratic *in retail too*, so this is a deliberate improvement rather than a bug
  fix. `FRONTEND_TUNING.rendering.weatherOpacityScale` scales authored weather opacity only;
  celestial layers pass 1 and are untouched. Verified the knob actually bites: both rain surfaces
  are `ALPHA | ADDITIVE`, which `objectBlendPolicy` maps to `SRC_ALPHA, ONE`, so alpha scales the
  added light. A pure-additive surface without the `ALPHA` bit would map to `ONE, ONE` and ignore
  it, which is why this was checked rather than assumed. Marker, citation, safety evidence, and
  census live on the constant; setting it to 1 restores retail exactly.
- **The profiling debt was paid rather than argued away.** The first measurement compared total
  frame cost between a clear and a rainy day group and found ~0.1 ms of CPU difference and no GPU
  difference — but `gpu.totalMs` is the sum of *named* phases and there was no sky phase, so the
  sky's GPU cost was not "zero", it was unmeasured. Rather than report an unfalsifiable number, the
  named `sky` phase was added. Both passes share one phase: they are one cost to reason about, and
  elapsed queries cannot nest.
- **Measured cost, real GPU, landblock `0xda55ffff`, camera height 120:** sky GPU 0.099 ms clear
  (day group 0) against 0.230 ms rainy (day group 3) — weather roughly doubles the sky pass and
  adds ~0.13 ms. Whole-frame GPU is 0.61 ms against 0.63 ms. No attention warranted beyond having
  made it visible.
- Two temporary Rust probes (the day-group/closure census and the emitter-surface probe) and one
  temporary renderer log were removed after recording their findings. The `--no-weather` harness
  flag and the `skyScripts` diagnostic are permanent: both answer questions that recur.

## Risks and Mitigations

### The Landed Script-Target Contract Cannot Host Sky Targets

The effects plan shapes its target port around authored residents. Mitigation: Phase R is a
mandatory gate with an explicit stop-and-renegotiate outcome; this plan may not fork a parallel
script runtime under any circumstances.

### The After-Landscape Pass Fights the Existing Pass Order

Our sky draws before the world with depth-always; retail draws weather after the landscape.
Mitigation: Phase 0 pins the exact retail ordering and depth semantics before Phase 1 designs the
pass; the world pass's own state must remain untouched, as the sky pass proved is achievable.

### Viewer-Pinned Motion Reads as Broken

A sheet pinned to the camera can look like a rendering bug rather than rain. Mitigation: verify
against retail captures or ACE-connected observation of rainy landblocks, not intuition.

## Definition of Done

- [x] Rainy day groups render authored rain sheets and emitter effects; clear groups and
      interiors render none.
- [x] All four censused sky physics scripts execute on the effects runtime with recorded behavior
      and provenance-complete unsupported reporting.
- [x] Weather toggling matches retail's recreate semantics with no residency or state leaks. Sky
      scripts drop from three to one and their assets are released; celestial state is untouched.
- [x] No new sky schema fields; no forked script/particle/audio machinery; no dormant
      infrastructure for environment overrides. One scope boundary was widened by explicit decision
      (untextured particle materials) and is recorded under Phase 3 rather than quietly taken.
- [x] Formatting, lint, tests, Rust checks, and Clippy pass; architecture docs updated.

## Known Gaps at Close

Every deliverable and acceptance criterion is met. These are carried forward deliberately, not
overlooked, and each is written up in full under the phase that found it.

| Gap                                                         | Owner phase | Status                                                                |
| ----------------------------------------------------------- | ----------- | --------------------------------------------------------------------- |
| Object path shares the palette/sampler binding hazard        | Phase 1     | **Fixed 2026-08-08**; blended pass now primes its sampler units       |
| Sky script assets evicted and re-fetched on teardown         | Phase 2     | **Fixed 2026-08-08**; staged assets retained per script id            |
| Retail's depth state for sky-object particles                | Open Q4     | Parked; unobservable in shipped content, evidence now argues we match |
| Rollover and region-unload teardown not separately observed  | Phase 2     | Carried; structurally identical to the paths that were exercised      |
| Neither material drop path has a test                        | Phase 3     | Carried; `ParticleMeshResidency` has no test harness                  |
| Sky pass does not implement untextured surfaces              | Phase 3     | Carried deliberately; no shipped sky object authors one               |

The two fixed items were both real defects rather than tidiness: the first was a latent draw
failure reachable by any view of purely transparent objects, and the second was a regression this
plan introduced. Nothing remaining is known to change rendering output.

## Open Questions

1. ~~What does the celestial script `0x330007DB` actually do?~~ Answered 2026-08-06: three
   root-attached ambient particle emitters started once at `t=0` (see Phase 0).
2. ~~Where does retail's `weather_enabled` live, and does anything beyond the after-cell objects
   read it?~~ Answered 2026-08-07: `LScape::weather_enabled`, a static bool driven by the
   character option `DisableMostWeatherEffects` via `SmartBox::EnableWeather`. Four readers
   total — object creation, both draw passes' gates, and toggle detection (see Phase 0).
3. ~~Do the rain sheets need the after-landscape pass for correctness, or only for the
   outdoors-only gate — i.e., could depth-tested drawing in the world pass reproduce retail's
   result with less pass machinery?~~ Answered 2026-08-07: the pass is required for correctness.
   Sky/weather polys draw depth-always with writes off and bypass the alpha list, so terrain
   never occludes rain; depth-tested world-pass drawing cannot reproduce that (see Phase 0).
4. **Do sky-object particles inherit the sky's depth state in retail?** Raised, advanced, and then
   **parked as not worth resolving** on 2026-08-08. The *sheets* are settled and we match them
   (acclient.c:297402, 434175). For particles, what is established: `CPhysicsObj::DrawRecursive`
   (acclient.c:306364) draws only the part array and children, so particles are not drawn by the
   object recursion; an emitter builds one particle `CPhysicsObj` (`makeParticleObject`,
   acclient.c:318016) whose parts reach a cell only through `AddPartToShadowCells`
   (acclient.c:306479), which needs that object to have a cell or shadow cells; and a cell draw
   renders its `shadow_object_list` (acclient.c:437618-437641).

   Two findings then argued against pursuing it. Structurally,
   `CPhysicsObj::set_cell_id_recursive` (acclient.c:306444) propagates a cell to the part array and
   children but **not** to particle emitters, and explicitly skips the part array when
   `state & 0x1000` — a bit `makeParticleObject` sets. Particle objects are deliberately excluded
   from that propagation, which makes "sky particles live in the sky cell, and so draw
   depth-always" materially less likely than it first appeared. Observationally, a reviewer
   comparing our weather against retail directly reported no discernible difference in the
   particles.

   Both readings are consistent with the same practical point: the shipped weather emitters produce
   a handful of particles at a time (measured: 3 emitters, 9 live particles) and are viewer-pinned,
   so like the sheets they are near-field and sit in front of most geometry whichever depth mode
   applies. The remaining unknown is therefore real but unobservable in shipped content — a
   documented gap rather than a divergence, and it needs no marker.

   If it ever needs settling, the cheap test is observational rather than archaeological: stand
   immediately beside a wall or tree during rain in retail and see whether particles draw over it.
   Ours are depth-tested and would not.
