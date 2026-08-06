# Holtburger 3D Weather and Sky-Script Runtime Plan

Status: Queued — blocked on the authored-effects plan; a boundary dry-run against its landed PES
and particle contracts is mandatory before any phase executes
Created: 2026-08-06
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md` (parallel track)
Prerequisites:

- `docs/plans/holtburger-3d-sky-pass-plan.md` (complete 2026-08-06)
- `docs/plans/holtburger-3d-static-authored-effects-runtime-plan.md` (queued)

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
  renegotiates it with evidence rather than forking it.
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
  `properties`, `isCelestial`, and the PES id losslessly; the resolver keeps weather objects and
  marks them, leaving nothing to re-derive.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-sky-pass.ts`: celestial residency, draw policy,
  and the derived-phase scroll arithmetic (`skyTextureOffset`) the rain sheets' `tex_velocity`
  (up to `(0.02, -2.0)`) also uses.
- `apps/holtburger-3d/src-tauri/src/sky_source.rs`: the sky record already projects every gfx id a
  sky draw can reach; Phase 0 verifies the weather GfxObjs and emitter Setups ride the same
  closure.
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

Progress: Script decode complete (2026-08-06); retail draw-policy, `weather_enabled`, and
pass-ordering evidence remains.

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

- Pin the rain sheets' full draw policy from retail: blend flags, depth behavior in the
  after-landscape pass, and how the z-clamped sheet interacts with terrain depth.
- Pin `weather_enabled` semantics: where retail stores it, what toggling destroys and recreates,
  and whether any state survives a toggle.
- Pin the after-cell pass ordering precisely: what "drawn after the landscape" means relative to
  our world pass, transparency ordering, and portal compositing.
- Verify the weather GfxObjs and emitter Setups resolve through the existing sky record closure
  with no missing dependencies.

#### Acceptance Criteria

- Every implementation phase cites exact asset ids, decoded event workloads, and decompile line
  references; no formula or lifecycle rule is guessed.
- ~~The celestial script `0x330007DB`'s actual behavior is recorded.~~ Recorded 2026-08-06: it is
  pure ambient particles — three root-attached emitters started once at `t=0`, no repetition, no
  sound. Phase 2's verification is therefore visual (three attributable emitters on
  `0x02000714`), and the emitter-info assets `0x32000455`-`0x32000457` are the fixtures.

#### Decisions and Course Corrections

- Pending execution.

### Phase R: Boundary Dry-Run (mandatory gate)

Progress: Blocked until the effects plan completes.

Rewrite Phases 1-4 against the effects plan's landed contracts: the real script-target port shape,
scheduling and clock semantics, particle/audio consumer interfaces, and whatever course
corrections its execution recorded. Confirm the second-target-ownership extension is still an
extension and not a redesign; if the landed shape cannot host sky targets without forking, stop
and renegotiate at the roadmap level before implementing.

#### Decisions and Course Corrections

- Pending execution.

### Phase 1: Weather Placement and Rendering

Progress: Not started (direction until Phase R).

#### Deliverables

- Viewer-pinned placement for weather objects per retail: XY pin, z = −120 clamp unless bit 8.
- The after-landscape weather draw pass, gated outdoors-only, reusing the sky pass's residency and
  scroll-phase arithmetic for the rain sheets.
- A weather-enabled explorer control with retail's recreate-on-toggle semantics.

#### Acceptance Criteria

- Rainy day groups render scrolling rain sheets over terrain from inside the world, verified in
  the harness across camera motion; non-rainy groups and interiors render none.
- Toggling weather off and on recreates weather state without leaking residency or affecting
  celestial rendering.

#### Decisions and Course Corrections

- Pending execution.

### Phase 2: Sky Script Targets

Progress: Not started (direction until Phase R).

#### Deliverables

- Extend the script runtime's target port to sky-module-owned objects with generation-safe
  identity, activation on day-group entry/visibility, and teardown on day-group rollover, weather
  toggle, and region unload.
- Activate the celestial `0x330007DB` on `0x02000714` in every day group.

#### Acceptance Criteria

- The celestial script executes with the behavior Phase 0 recorded; unsupported commands report
  provenance, never vanish.
- Day-group rollover and region unload tear down sky script clocks, queued activations, and
  acquired closures atomically.

#### Decisions and Course Corrections

- Pending execution.

### Phase 3: Weather Emitter Scripts

Progress: Not started (direction until Phase R).

#### Deliverables

- Activate the three weather-emitter scripts on their Setup-backed sky objects; their particles
  and audio flow through the effects runtimes with viewer-pinned source transforms.

#### Acceptance Criteria

- Rainy groups produce the emitters' authored particle and audio behavior, attributable per
  script; disabling weather stops and cleans them deterministically.

#### Decisions and Course Corrections

- Pending execution.

### Phase 4: Resteer, Measure, and Clean Up

Progress: Not started.

- [ ] Measure weather pass and sky-script cost; the sky pass's profiling debt (no named `sky`
      phase) is paid here if either needs attention.
- [ ] Sweep any temporary probes, placeholder gates, or dead vocabulary introduced along the way.
- [ ] Update `docs/lighting.md`'s sky/weather sections and close the physics-script seam note.

#### Decisions and Course Corrections

- Pending execution.

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

- [ ] Rainy day groups render authored rain sheets and emitter effects; clear groups and
      interiors render none.
- [ ] All four censused sky physics scripts execute on the effects runtime with recorded behavior
      and provenance-complete unsupported reporting.
- [ ] Weather toggling matches retail's recreate semantics with no residency or state leaks.
- [ ] No new sky schema fields; no forked script/particle/audio machinery; no dormant
      infrastructure for environment overrides.
- [ ] Formatting, lint, tests, Rust checks, and Clippy pass; architecture docs updated.

## Open Questions

1. ~~What does the celestial script `0x330007DB` actually do?~~ Answered 2026-08-06: three
   root-attached ambient particle emitters started once at `t=0` (see Phase 0).
2. Where does retail's `weather_enabled` live, and does anything beyond the after-cell objects
   read it?
3. Do the rain sheets need the after-landscape pass for correctness, or only for the
   outdoors-only gate — i.e., could depth-tested drawing in the world pass reproduce retail's
   result with less pass machinery? (Phase 0 evidence decides; North Star 2 says retail wins
   ties.)
