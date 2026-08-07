# Holtburger 3D Static-Authored Effects Runtime Plan

Status: Queued — resteered 2026-08-06 against the landed sky pass; Phase 1 is executable on
authorization
Created: 2026-07-31
Convergence review: 2026-08-01
Sky-pass resteer: 2026-08-06
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`
Prerequisites:

- `docs/plans/holtburger-3d-static-authored-animation-runtime-plan.md`
- `docs/plans/holtburger-3d-dynamic-entity-architecture-convergence-plan.md`

## Convergence Provenance

| Concern                                                                     | Branch-local status                     | Treatment                              |
| --------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------- |
| Canonical animation/hook foundation                                         | Complete on `3d-next` at `c09eb3c2`     | Preserve                               |
| Claude `TransparentPart` source/effect behavior                             | Complete on `claude` only at `c938a438` | Donor-proven, not canonical completion |
| Typed `TransparentPart` transport                                           | Complete on `3d-next`                   | Convergence Phase 3                    |
| Atomic `SetOmega` / `TransparentPart` playback and rendering                | Complete on `3d-next`                   | Convergence Phase 4                    |
| Remaining scripts, particles, audio, material effects, and structural hooks | Planned                                 | Resteered here by convergence Phase 5  |

No checkbox or phase in this document is complete merely because a donor implementation exists.
Convergence has now removed completed translucency scope and replaced the speculative router with a
measured producer/consumer sequence. Convergence closed 2026-08-01, so no prerequisite plan remains
active; Phase 1 is executable without a new architecture decision and awaits only authorization.

## Sky-Pass Resteer (2026-08-06)

The sky pass plan ([holtburger-3d-sky-pass-plan.md](holtburger-3d-sky-pass-plan.md)) completed
2026-08-06. It runs on a parallel track with no dependency in either direction, but it landed code
and evidence this plan's dry-run must acknowledge:

- **The derived-phase scroll model is now landed, tested code, not a shared intention.**
  `skyTextureOffset` (`apps/holtburger-3d/src/lib/game/renderer/webgl2-sky-pass.ts`) derives
  `phase = fract(rate × sharedClock)` in f64 with unit tests covering the negative authored rates.
  Phase 4's `TextureVelocity` consumer hoists or mirrors that arithmetic; it does not design a
  second derivation.
- **Retail's staged blend selection is now fully implemented in the shared `objectBlendPolicy`**
  (`apps/holtburger-3d/src/lib/game/renderer/object-rendering-policy.ts`), including the
  `SURFACE_TRANSLUCENT` final override (`D3DPolyRender`, acclient.c:434096-434160) the sky pass
  proved and blast-radius-audited. Phase 5's particle blend/depth policy consumes this shared
  policy rather than deriving a fresh mapping.
- **New reusable residency primitives exist for Phase 1's inventory:** standalone `TEXTURE_2D`
  residency via the exported `createTexture2DUpload` (native `GL_REPEAT`, no atlas), and the
  extracted `resolveObjectMaterialRanges` span primitive. The shared host resource projection was
  renamed from `OutdoorStaticSourceClosure` to `ObjectResourceClosure`
  (`apps/holtburger-3d/src-tauri/src/object_resource_closure.rs`).
- **A new script consumer is waiting at this plan's boundary, not inside it.** The sky census
  found 96 sky objects carrying `default_pes_object_id`, including the always-visible celestial
  `0x02000714` (PES `0x330007DB`) present in every day group. Sky objects are sky-module-owned and
  viewer-centered, not authored residents, so executing their scripts is out of scope here (see
  Out of Scope) and belongs to the scheduled follow-up plan
  ([holtburger-3d-weather-sky-script-runtime-plan.md](holtburger-3d-weather-sky-script-runtime-plan.md)),
  whose boundary dry-run runs when this plan completes. The 2026-08-06 evidence probe proved the
  sky attachment is authoring redundancy: every sky `default_pes_object_id` equals the referenced
  Setup's own `default_script`, so all four sky scripts already sit inside this plan's
  2,161-setup default-script census and their vocabulary (`CreateParticle`, `SoundTweaked`,
  `CallPES` only) is covered by this plan's committed consumers.

## Context and Boundaries

### Goal

Complete static-authored behavior fidelity by executing setup default physics scripts and their
proven visual, particle, audio, material, and chained-script effects on the shared authored dynamic
runtime.

### Problem Statement

The representative authored regions contain more setup-default script owners than animation owners.
Leaving those scripts inert omits ambient particles, sound, and visual behavior even after rigid-part
animation works. The animation plan deliberately preserves script identity and static presentation
but does not decode, schedule, or execute physics scripts.

This plan adds the second timed behavior producer and real effect consumers. It reuses the entity,
template, animation, effect, resource-lifetime, and renderer architecture established by the
animation and convergence plans; it does not create an effects-specific entity runtime or pull
spawned-entity infrastructure forward.

### In Scope

- Typed `PhysicsScript` DAT decoding and compact content transport.
- Shared prepared script repositories and transitive dependency closure.
- Deterministic per-entity physics-script clocks and `CallPES`.
- Safe preparation and runtime execution of intentional cyclic script graphs.
- Expansion of one prepared behavior-command union only for static-authored behavior proven by
  archive and reference evidence.
- Concrete visual mutation consumers required by authored scripts.
- Concrete particle playback/rendering for the proven `CreateParticle` workload.
- Concrete sound asset/playback behavior for the proven `SoundTweaked` workload.
- Atomic promotion of script-only authored residents after their complete behavior closure is ready.
- Combined animation and script clocks on the same entity without merging their ownership.

### Out of Scope

- Spawned/server entities, explorer drivers, entity feeds, motion tables, sparse anchors, or runtime
  reconciliation.
- General-purpose particle authoring tools, audio middleware, environmental mixing, or a universal
  effect graph.
- Implementing unused hook types merely because they exist in the DAT format.
- Silently approximating unknown hook payloads, timing, asset lookup, attenuation, or attachment
  semantics.
- Lighting work until an authored setup-default producer reaches a light command; the complete current
  archive census finds none in setup-default animation or script closure.
- Moving script, audio, or particle resource ownership into `EffectSystem`, or embedding decoded
  timelines in entity source records.
- Network-triggered physics scripts, combat effects, projectiles, or gameplay authority.
- `PhysicsScriptTable` decode, transport, and intensity selection — ratified out 2026-08-06.
  Retail evidence proves every table key is a gameplay `PScriptType` and every lookup consumer is
  network-, collision-, or hide-state-driven; a static authored resident structurally never
  reaches a table. The mechanism moves to the spawned-entity/explorer plan (roadmap stage 3),
  which inherits the 2026-08-06 table census and selection semantics recorded here as evidence.
- `ReplaceObjectHook` execution — ratified out 2026-08-06. Retail defines no
  `Execute` for hook type 5; the shipped client parses and preloads it, then does nothing, and
  the archive contains exactly two records. Our runtime decodes the hook and reports it
  intentionally-inert with provenance; no replacement resources are staged, no atomic swap is
  built, and the hook's presence no longer blocks animated activation. Appearance-time part
  selection via `ObjDesc.anim_part_changes` is unaffected (it remains in the animation plan's
  landed scope).
- Sky-object physics scripts (`default_pes_object_id`), including the always-visible celestial
  `0x02000714` / `0x330007DB` and the Rainy-group weather emitters. Sky objects are owned by the
  sky module and are viewer-centered rather than authored residents, so wiring the script runtime
  to a second target ownership is real scope this plan can finish honestly without. They become
  consumers of the systems landed here through the scheduled
  [weather/sky-script plan](holtburger-3d-weather-sky-script-runtime-plan.md); the sky schema
  already carries their ids losslessly.
- Entity-to-entity attachment mutation and animated parent-part following; those enter with the
  spawned lifecycle consumer in the spawned-entity plan. Particle/effect attachment to an authored
  root or part remains in scope here.

## Ground Truth and Existing Precedent

### Authoritative References

- `acclient-eor-source/acclient.c`
  - `CPhysicsObj::InitDefaults`: setup defaults initialize animation, physics script, physics-script
    table, sound table, and related behavior state.
  - `CPhysicsObj::animate_static_object`: static default animation and scripts advance independently.
  - `PhysicsScriptManager` and `PhysicsScriptTableManager`: timed scripts and table-selected scripts
    dispatch animation hooks.
  - `CAnimHook::GetSubDataIDs` and hook-specific implementations: dependency assets are enumerable
    before execution.
  - `ReplaceObjectHook` and `CPartArray` object-description mutation paths: timed part replacement
    selects a new part visual without replacing entity identity.
- `ACE/Source/ACE.DatLoader/FileTypes/PhysicsScript.cs`
- `ACE/Source/ACE.DatLoader/FileTypes/PhysicsScriptTable.cs`
- `ACE/Source/ACE.DatLoader/Entity/AnimationHooks/*`
- `ACViewer/ACViewer/Physics/PhysicsObj.cs:680-710`

### Existing Code to Extend

- The authored entity/template/animation/effect systems landed by the prerequisite animation and
  convergence plans.
- `crates/holtburger-core/src/content_assets.rs`
- `apps/holtburger-3d/src-tauri/src/lib.rs` compact binary content adapter patterns.
- Existing texture, geometry, transparent ordering, and frame-stream infrastructure for particle
  rendering where their contracts are genuinely reusable.
- Landed by the sky pass (2026-08-06): the shared `objectBlendPolicy` with retail's complete staged
  blend selection, standalone `TEXTURE_2D` residency via `createTexture2DUpload`, the
  `resolveObjectMaterialRanges` span primitive, the `skyTextureOffset` derived-phase scroll
  arithmetic, and the renamed host-side `ObjectResourceClosure`.
- The Phase 1 reuse inventory completed 2026-08-06 (working tree at `5ace1768`):
  - **Audio: greenfield in all three layers.** No Web Audio usage, no 0x0A decoder, no 0x20
    `SoundTable` mapping anywhere; the only prior art is an untested ad-hoc RIFF re-wrapper in
    `apps/holtburger-tools/src/bin/dat-tool.rs:518-537`.
  - **Particles: no runtime, but the instancing substrate fits almost verbatim.** A particle
    cohort is structurally a `VisibleRigidPartContribution` stream: one `RigidPartDrawUnit` per
    unique GfxObj/material plus N 20-float `ObjectInstanceData` records (matrix + RGBA, alpha
    already consumed as `1 − translucency`) through the existing `FrameInstanceStreamArena` /
    `WebGL2InstanceBuffer` path. Missing pieces are only the emitter/particle simulation owner
    and 0x32 asset decode.
  - **Transport is a clone of the animation lane:** `animation_source.rs` (typed hook-payload
    manifest + raw escape hatches) is the record template, `object_resource_closure.rs` the
    dependency-closure template, and `animation-asset-repository.ts` is verbatim the "shared
    in-flight preparation, ready/failed state, acquired handles, deterministic release" shape
    Phase 2 specifies.
  - **DAT decode:** `DatFileType` variants for 0x33/0x34 exist with no decoders; 0x32, 0x20, and
    0x0A have no variants at all. New modules follow the manual-`binrw`-sequential-read idiom of
    `file_type/animation.rs`.
  - **No unified clock exists.** The renderer's `input.timeSeconds` and
    `AnimationSystem.advance(timeSeconds)` both originate in the runtime frame loop but are not
    expressed as one named source; `game-clock.ts` is day-fraction only. Script clocks require a
    small clock unification, and `skyTextureOffset` (already exported) hoists cleanly.
  - The sky contract already transports `0x330007DB` to the frontend today (as
    `sky-state.ts`'s dead-ending `particleEffectId`), confirming the sky seam needs no schema
    change.

### Measured Workload

The recorded representative scans contain 66 and 52 setup default-script owners in `0xDA55FFFF` and
`0xDC58FFFF`. The 14 default-script roots contain 25 authored events:

| Event            | Count | Required initial consumer |
| ---------------- | ----: | ------------------------- |
| `CreateParticle` |    17 | Particle runtime/renderer |
| `CallPES`        |     5 | Script scheduler          |
| `SoundTweaked`   |     3 | Audio runtime             |

Transitive `CallPES` traversal reaches 17 scripts total. Four shipped scripts
(`0x330003CC`, `0x33000711`, `0x3300072C`, and `0x33000863`) call themselves. Preparation traversal
must terminate without rejecting these graphs, while runtime scheduling must not recurse
synchronously forever. Shipped cycles are not only self-loops: the 2026-08-06 evidence probe found
mutual two-script cycles (`0x33000428` ↔ `0x33000429` and `0x3300042C` ↔ `0x3300042D`, each side
re-calling the other after 2.8 s), so cycle handling must be graph-general, not
self-reference-special-cased. The probe also observed `CallPES` `pause` in the wild:
`0x33000453` re-calls itself at `t=0` with `pause=30`, making pause semantics load-bearing for
authored repetition rates.

**Corrected 2026-08-06 by a re-measurement (temporary `effects_script_fixture_probe`, removed after
recording).** The 66/52/14-root/25-event/17-script figures above are inherited from a pre-convergence
scan whose owner-discovery path was never recorded, and they do not reproduce. Re-walking the two
landblocks through the same owner families the app actually realizes — `explicit_objects`,
`buildings`, `GeneratedSceneryAssetAssembler` output, and `LandblockInteriorSystemAssembler` cell
`static_objects` — yields:

| Measure                                | Inherited | Measured 2026-08-06 |
| -------------------------------------- | --------: | ------------------: |
| `0xDA55FFFF` default-script placements |        66 |                  22 |
| `0xDC58FFFF` default-script placements |        52 |                  38 |
| Unique default-script roots            |        14 |                   9 |
| Scripts in `CallPES` closure           |        17 |                  11 |
| Authored `CreateParticle` events       |        17 |                   8 |
| Authored `SoundTweaked` events         |         3 |                   5 |
| Authored `CallPES` events              |         5 |                   6 |

The measured figures are authoritative going forward because their discovery path is written down
and matches the realizer; the inherited ones are retained above only as provenance. Acceptance
criteria that quoted the old counts are restated against the measured closure. Distinct assets
behind those events — 7 emitter infos and 3 sounds across 19 records — give the shared-preparation
dedup fixtures for free.

The complete measured representative closure, recorded here as the source of the checked-in
fixtures:

| Script       | Root | t   | Event            | Payload                                                      |
| ------------ | ---- | --- | ---------------- | ------------------------------------------------------------ |
| `0x33000253` | yes  | 0   | `CreateParticle` | info `0x3200020C`, part 0, offset (0,0,0), emitter 0         |
| `0x33000253` |      | 0   | `SoundTweaked`   | sound `0x0A00038A`, probability 1.0, unused 0.0, volume 0.01 |
| `0x33000253` |      | 2   | `CallPES`        | `0x330003CC`, pause 0                                        |
| `0x330003CC` | no   | 0   | `SoundTweaked`   | sound `0x0A00038A`, probability 1.0, unused 0.0, volume 0.01 |
| `0x330003CC` |      | 2   | `CallPES`        | `0x330003CC` (self), pause 0                                 |
| `0x330003D8` | yes  | 0   | `SoundTweaked`   | sound `0x0A00038A`, probability 1.0, unused 0.0, volume 0.01 |
| `0x330003D8` |      | 2   | `CallPES`        | `0x330003CC`, pause 0                                        |
| `0x330003EC` | yes  | 0   | `CreateParticle` | info `0x320002A5`, part 0, offset (0,0,10), emitter 0        |
| `0x330003EC` |      | 0   | `CreateParticle` | info `0x320002A5`, part 0, offset (0,0,6), emitter 0         |
| `0x330006EF` | yes  | 0   | `CreateParticle` | info `0x320003A6`, part −1, offset (0,0,0), emitter 0        |
| `0x33000711` | yes  | 0   | `SoundTweaked`   | sound `0x0A000341`, probability 1.0, unused 0.0, volume 0.1  |
| `0x33000711` |      | 3   | `CallPES`        | `0x33000711` (self), pause 0                                 |
| `0x330007DF` | yes  | 0   | `CreateParticle` | info `0x32000829`, part −1, offset (0,0,1.2), emitter 0      |
| `0x33000862` | yes  | 0   | `CreateParticle` | info `0x32000478`, part −1, offset (0,0,1), emitter 0        |
| `0x33000862` |      | 0   | `CallPES`        | `0x33000863`, pause 0                                        |
| `0x33000863` | no   | 0   | `SoundTweaked`   | sound `0x0A000207`, probability 1.0, unused 0.0, volume 0.3  |
| `0x33000863` |      | 2   | `CallPES`        | `0x33000863` (self), **pause 1.0**                           |
| `0x33000BA5` | yes  | 0   | `CreateParticle` | info `0x3200061F`, part −1, offset (0,0,0.5), emitter 0      |
| `0x33001013` | yes  | 0   | `CreateParticle` | info `0x32000894`, part −1, offset (0,0,0), emitter 0        |

Three findings fall out of that table and change downstream work:

- **The `SoundTweaked` field-order correction is independently corroborated by the content.** Every
  representative record authors `f1 = 1.0` and `f2 = 0.0`. Under ACE's `Priority, Probability`
  naming the second float is the probability, so every one of these ambient sounds would roll a
  0.0 chance and never play. Under retail's proven order (first float is the probability roll,
  second is discarded) they all play. The archive only makes sense read retail's way, so the decode
  names the fields `probability`, `unused`, `volume` as Phase 6 already specifies.
- **The random `CallPES` pause is representative, not sky-only.** `0x33000863` self-calls with
  `pause = 1.0`, so the `RollDice(0, pause)` deferral path is exercised by the measured workload and
  is not a weather-plan-only concern. Phase 3 must implement it, not stub it.
- **Both attachment forms are present**: `part = −1` (whole object) in six events and `part = 0`
  (part-indexed) in three, which is the split Phase 5 already anticipated. Every offset is a pure
  translation with an identity quaternion, consistent with retail never applying the hook frame's
  rotation.

Three of the four recorded self-cycles (`0x330003CC`, `0x33000711`, `0x33000863`) are inside the
measured closure; `0x3300072C` is reached only by the archive-wide census. Two roots enter a cycle
rather than being one (`0x330003D8` → self-cycling `0x330003CC`; `0x33000862` → self-cycling
`0x33000863`), so the runtime must handle "root leads into a cycle" and not only "root is a cycle".

The representative setup appearances do not use default physics-script tables. Table selection is
therefore an evidence gate for broader shipped content rather than something to infer from the
representative regions.

The 2026-08-01 convergence dry-run revalidated and widened that evidence against the current ignored
`dats/assets.hba` without retaining an asset-dependent test:

| Producer scope                    | Hook type         | Count | Named consumer                                       |
| --------------------------------- | ----------------- | ----: | ---------------------------------------------------- |
| All setup-default script closures | `SoundTable`      |    49 | Audio runtime + prepared sound-table lookup          |
| All setup-default script closures | `Scale`           |    43 | `EffectSystem` scale state + dynamic publication     |
| All setup-default script closures | `CreateParticle`  | 7,753 | Particle runtime/renderer                            |
| All setup-default script closures | `CallPES`         |   352 | `PhysicsScriptSystem` scheduled activation           |
| All setup-default script closures | `SoundTweaked`    |   319 | Audio runtime                                        |
| All setup-default script closures | `TextureVelocity` |    11 | `EffectSystem` material state + renderer UV sampling |
| All setup-default animations      | `SoundTable`      |     4 | Audio runtime + prepared sound-table lookup          |
| All setup-default animations      | `TransparentPart` |    12 | Complete in convergence Phase 4                      |
| All setup-default animations      | `SoundTweaked`    |    14 | Audio runtime                                        |
| All setup-default animations      | `SetOmega`        |     8 | Complete in convergence Phase 4                      |

The complete archive contains 2,161 setups with direct default scripts. Their `CallPES` closure
reaches 2,190 scripts and includes the four representative self-cycles plus many additional shipped
self-cycles. Six setup default-script tables are present (`0x34000005`, `0x340000A5`, `0x340000BA`,
`0x340000BF`, `0x340000C7`, and `0x340000CE`), so table decoding remains real broader-content work
despite its absence from DA55/DC58.

The 2026-08-06 evidence probe decoded all six tables (format proven from ACE
`PhysicsScriptTable.Unpack`: plain u32-count dictionary of key → `(mod f32, script u32)` list) and
found each is referenced by exactly one shipped setup:

| Table        | Keys | Script refs | Closure | Referencing setup |
| ------------ | ---: | ----------: | ------: | ----------------- |
| `0x34000005` |    3 |           7 |       7 | `0x02000271`      |
| `0x340000A5` |  112 |         302 |     241 | `0x02000177`      |
| `0x340000BA` |    2 |           4 |       5 | `0x0200167F`      |
| `0x340000BF` |  108 |         298 |     257 | `0x020014E1`      |
| `0x340000C7` |    3 |           3 |       3 | `0x02001807`      |
| `0x340000CE` |    2 |           2 |       2 | `0x02001A46`      |

Observed keys are script-type values (4, 5, 6-90 ranges); mods author 0 / 0.5 / 1 triplets where a
key has intensity variants and a single `mod=1` entry where it does not. Script `0x33000109`
(key 90) is shared by three tables, giving a shared-preparation dedup fixture for free. This
answers Open Question 1: `0x340000BA` is the smallest fixture that still proves keys, modifier
selection (key 81 authors a 0 / 0.5 / 1 triplet), single-entry fallback (key 89), and nontrivial
closure (5 scripts); `0x340000CE` is smaller but authors only `mod=1` entries and cannot exercise
modifier selection. Following the 2026-08-06 scope ratification, this census and the fixture
answer are inherited by the spawned-entity plan along with the table mechanism itself.

The complete animation census found only two `ReplaceObjectHook` records, both on animation
`0x0300055B` frame 0: forward replaces part 1 with GfxObj `0x01000BB4`, and backward replaces part 1
with `0x01000BB5`. The 2026-08-06 retail evidence (see ReplaceObject below) proved the shipped
client never executes this hook type, and its execution was ratified out of scope; the two records
now serve only as decode/inert-reporting fixtures.

A 2026-08-05 census pinned the `TextureVelocity` mechanism's retail semantics before Phase 4
designs its state: retail keeps one global accumulator per GfxObj DataID
(`CPhysics::texture_velocity_gids`; registration dedupes by DataID with last-writer-wins rates in
`CPhysics::AddGfxVelocity`, acclient.c:300196), advances it per frame
(`CPhysics::UpdateTexVelocity`, acclient.c:299999), and writes the accumulated offset onto the
shared cached `CGfxObj` mesh — so every rendered instance of a DataID scrolls in phase,
regardless of when each object's script activated. `TextureVelocityHook::Execute` and the sky's
direct `GameSky::MakeObject` path are the registry's two writer kinds; the census found the hook
writers are exclusively physics scripts (11 scripts, whole-object, rates such as `(0.03, 0.03)`)
with zero occurrences in all 2,066 portal animations and zero `TextureVelocityPart` hooks
anywhere. The phase-sharing is plausibly deliberate seam synchronization for tiled flowing
surfaces (waterfalls): per-entity scroll clocks started at different script-activation times
would visibly tear at seams between instances of the same GfxObj.

Our model reproduces that seam synchronization without retail's mutable registry: scroll phase is
derived, not accumulated — `phase = fract(rate × sharedClock)`. Any two draws with the same rate
are in lockstep by arithmetic identity, which covers all instances of a GfxObj because they share
one authored rate; the rate itself is a static material fact carried by content identity, so no
GfxObj threading and no per-frame mutable state exist anywhere. Absolute phase origin differs
from retail (accumulators start at first hook activation) but is unobservable for a looping
scroll — only relative phase between same-texture instances is visible, and that is identical.
The model's one precondition: derivation assumes each scrolling texture's rate is constant for
the session (`fract(r × t)` equals `fract(∫r dt)` only for constant `r`; a mid-session rate
change would retroactively rescale all elapsed time and visibly snap the texture). **Verified
2026-08-06 by the evidence probe:** all 11 `TextureVelocity` scripts are whole-object with one
rate each, and walking every setup default-script/table closure in the archive assigns no GfxObj
DataID two distinct script-driven rates. The phase-bias escape hatch is not needed. The audit's
one conflict is sky-authored, not script-authored: the overcast cloud sheet `0x01004C35` carries
rate `(0.005, −0.0073)` in the Cloudy day groups but `(0.013, −0.013)` in the Rainy groups. The
two rates never coexist — day groups are exclusive — so within any active group the precondition
holds; the only divergence from retail is a phase-origin snap on that sheet at day-group
rollover, where retail's accumulator is continuous. Bounded, once per rollover, on an overcast
texture; accepted. If a same-session rate change is ever proven, the escape hatch is a lazily
written phase bias at the change event (`phase = fract(newRate × (t − T) + phaseAtT)`) — still no
per-frame mutation — and it is not built until then. Derive `fract` in f64 CPU-side (or
wrap the clock) before values reach f32 uniforms; `rate × t` degrades in f32 over multi-hour
sessions. The sky pass landed exactly this derivation 2026-08-06 as the unit-tested
`skyTextureOffset` (`webgl2-sky-pass.ts`); Phase 4 shares that arithmetic and clock rather than
building a parallel one.

No setup-default script closure or setup-default animation emits a lighting hook. Lighting is
therefore removed from this executable roadmap instead of receiving a speculative state field,
system, or phase. The archive-wide animation vocabulary contains other gameplay-oriented hooks, but
those remain outside this static-authored scope until a selected producer needs them.

## Retail Execution Evidence (2026-08-06)

Phase 1's retail-behavior evidence, gathered by targeted decompile reads. Every claim cites
acclient.c; ACE/ACViewer are noted where they corroborate or are stubs.

### Script Execution and Timing

- **Runtime shape** (`ScriptManager`, acclient.c:316321-316475): one lazily created manager per
  `CPhysicsObj` holding a FIFO queue of `ScriptData { start_time: f64 absolute seconds, script }`.
  Record times are f64 offsets from the owning script's absolute start; the clock is the wall
  clock (`Timer::cur_time`), never the sub-stepped physics clock — scripts are not sub-stepped.
- **Scripts play once; there is no auto-repeat** (completion path acclient.c:316445-316470). The
  only repetition mechanism is a `CallPES` cycle. A finished script's node is released; the
  manager persists empty on the object.
- **Queued scripts concatenate seamlessly:** `AddScriptInternal` (acclient.c:316331-316355)
  starts a new script at `last.start_time + last.script.length` when the queue is non-empty
  (`length` = the max record time, computed at unpack), and at `Timer::cur_time` only when the
  queue is empty. A self-`CallPES` loop therefore repeats at exactly the script's authored
  length with **zero drift** — and the calling script is never terminated by `CallPES`.
- **`CallPES` `pause` is a uniform random delay bound, not a fixed delay**
  (`CPhysicsObj::CallPES`, acclient.c:307316-307345): `pause >= 0.0002` rolls
  `RollDice(0, pause)` and defers activation through an FPHook that fires the script only at
  interpolation completion and only if the object is in a cell; `pause < 0.0002` starts the
  script synchronously inside the update loop. The weather rain loops (`pause=0`) are the
  synchronous case; `0x33000453`'s `pause=30` re-arms at a random point within 30 s, not at 30 s.
- **Records are sorted by time at unpack; equal-time order is undefined in retail.**
  `PhysicsScript::UnPack` runs `qsort` with a comparator that never returns 0 and is not a
  strict weak ordering (acclient.c:322940-322948, 323160), so authored file order is not
  execution order, and equal-timestamp order is implementation-defined even in retail. Our
  runtime sorts by time with a **stable** tiebreak on authored order and records that as a
  deliberate, documented divergence retail itself cannot contradict.
- **Producer order within a frame differs by object class** (`CPhysics::UseTime`,
  acclient.c:300072-300118): active objects run animation hooks _before_ script hooks
  (`UpdatePositionInternal` → `process_hooks` → `UpdateScripts`); **static animating objects run
  script hooks _before_ this frame's animation hooks** (`animate_static_object`,
  acclient.c:309368-309409: part update queues anim hooks → `UpdateScripts` → `process_hooks`).
  All active objects update before any static object. Statics are this plan's population, so the
  runtime tick order is scripts-then-animation.
- **Initial phase: none.** Scripts start at phase 0 at `Timer::cur_time` when added
  (`InitDefaults` plays the setup script before enrolling the static object,
  acclient.c:309089-309138); `RollDice` appears exactly once in the entire script path (the
  `CallPES` pause). Retail's apparent desynchronization among identical residents comes purely
  from differing creation instants. (Our `AnimationSystem`'s per-entity FNV phase offsets serve
  the same purpose for animation; script clocks get their spread the same way or none.)
- **Catch-up: crossed hooks execute, never fold or skip — up to a 2-second cliff.**
  `UpdateScripts` drains every overdue hook in a burst; but `animate_static_object` and
  `update_object` discard deltas above 2.0 s wholesale (reset `update_time`, run nothing that
  frame; acclient.c:309381-309416, 311183-311211). So retail's answer to Open Question 5 is:
  within 2 s, replay everything; beyond 2 s, drop the elapsed time entirely. Deterministic
  initial-state folding as this plan defines it has no retail counterpart to contradict.
- **No runaway protection exists in retail.** No iteration cap, no budget, no recursion guard.
  A zero-length script that self-calls with `pause=0` infinite-loops the retail client with
  unbounded allocation (acclient.c:316331-316471 has no guard). Our bounded-dispatch requirement
  is a deliberate, necessary improvement, not a parity deviation.
- **Script-sourced hooks ignore direction filtering:** `UnPackHook` stamps `direction = -2` and
  `ScriptManager` executes hooks unconditionally (acclient.c:316443), unlike animation-frame
  hooks, which filter by playback direction in `CSequence::execute_hooks`.

### Script-Table Selection

- **Selection rule** (`PhysicsScriptTableData::GetScript`, acclient.c:323183): linear scan in
  authored file order, picking the **first entry whose `mod >= requested`** (ceiling match; the
  comparison promotes to f64). No sorting, no nearest-match, and **no top clamp**: a requested mod
  above every authored mod falls off the end and yields the invalid DID. A `0 / 0.5 / 1` triplet
  therefore buckets as `(−∞,0] → entry0, (0,0.5] → entry1, (0.5,1] → entry2, (1,∞) → nothing`.
- **Missing key** (`PhysicsScriptTable::GetScript`, acclient.c:323537-323558): hash-chain miss
  returns the invalid DID; there is no fallback key, and callers do not check — the invalid DID
  no-ops inside `play_script_internal` (`if (!a2) return 0`, acclient.c:306395). Silent no-op is
  retail's authored miss behavior, which our provenance-first reporting deliberately improves on.
- **Two independent default-script slots, never competing.** The _setup's_ `default_script` is a
  raw script DID played once, unconditionally, at `CPhysicsObj::InitDefaults`
  (acclient.c:309101) — the table is never consulted for it. The _object-level_ `default_script`
  is a `PScriptType` **key** plus `default_script_intensity`, populated only from the network
  `PhysicsDesc` (acclient.c:319092-319106, 310514-310516), and consumed only by
  `play_default_script` → table lookup (acclient.c:308602-308619). The setup's
  `default_script_table` merely installs `physics_script_table` (acclient.c:309126); loading it
  plays nothing.
- **Intensity (`mod`) is a per-event float sent by the server** (`SmartBox::HandlePlayScriptType`,
  acclient.c:137238; ACE `GameMessageScript` and emote `Extent`); observed values are exactly
  0.0 / 0.5 / 1.0. The clearest retail use: `PS_PortalStorm` played at 0.0 ("subsided",
  acclient.c:385069) versus 1.0 ("imminent", acclient.c:385100).
- **The six shipped tables are gameplay-event tables, not ambient behavior.** Their keys decode to
  `PScriptType` values `PS_Launch` (4), `PS_Explode` (5), `PS_Fizzle` (81), `PS_Destroy` (89),
  and `PS_ProjectileCollision` (90) (acclient.h:2937-3115; ACE `PlayScript` matches). Every
  runtime consumer of table selection is network- or collision-driven (`play_script` from the
  wire, `set_hidden`, `DoCollision`, the `DefaultScript` anim hook reading the network-populated
  key). **A static authored resident never performs a table lookup.** Scope consequence recorded
  in Phase 2's decisions.
- **ACE and ACViewer `PhysicsScriptTable.GetScript` are stubs returning 0** (ACE
  `Physics/Scripts/PhysicsScriptTable.cs:15-18`; ACViewer identical) — do not use them as
  selection-semantics references. ACE's DatLoader unpack is real and matches our proven format.
- `InitDefaults` also registers static animating state: setup `default_anim_id` sets state bit
  `0x40000`, `default_script_id` sets `0x80000`, either enrolls the object via
  `CPhysics::AddStaticAnimatingObject` (acclient.c:309131-309138).

### Sound

- **`SoundTable` resolution** (`SoundTableHook::Execute` → `SoundManager::PlaySoundA`,
  acclient.c:328534-328537, 366969-366990): the table is the **object's** `sound_table`,
  installed from the setup's `default_sound_table` (0x20 `STable`, acclient.c:309104-309115) or
  overridden by the network `PhysicsDesc`. Lookup hashes the sound-type key; multiple candidates
  pick uniformly at random — with a genuine retail bug: the index is `floor((n−1) × roll)`, so
  **the last candidate in a list is never selected** (acclient.c:366752-366756). The chosen
  entry's `probability` gates a play-chance roll; `volume` is linear gain; `priority` is used
  only for voice stealing across the 16 global voices.
- **`SoundTweaked` field-order trap, proven from offsets** (acclient.c:329412-329431,
  328517-328525, 366790-366812): retail's `Execute` uses the **first float after the sound id as
  the probability roll and discards the second entirely** — ACE's `Priority, Probability` field
  naming is inverted relative to actual use, and the "priority" retail applies is the
  `SoundData` default 0.0, so hook sounds lose every voice-steal contest. Our decode must name
  the fields by proven behavior (`probability`, `unused`, `volume`), not by ACE's labels.
- **Spatialization** (acclient.c:366427-366519): position sampled once at trigger time from the
  emitting object; gain flat within 5 m then `25 × volume / d²`, a hard −50 dB cutoff (~89 m at
  full volume — below it the sound is not played at all), heading-based stereo pan beyond 5 m.
  No 3D buffers; no looping in the hook path (repeating ambience is retail's separate `Ambient`
  scheduler, out of scope). Sixteen global voices with priority stealing.
- **0x0A assets** are `WAVEFORMATEX` header + payload (DB type 15); format tag `0x55` means MP3,
  which retail decodes through ACM to PCM 11025 Hz/16-bit/mono. Our audio runtime needs a wave
  _and_ MP3-capable decode path or an explicit unsupported-format report.
- **Teardown:** playing voices are fire-and-forget copies with no back-pointer — a sound
  triggered by an object **finishes playing after the object is destroyed**
  (acclient.c:366405-366407; `CPhysicsObj::Destroy` never touches voices). Owner removal
  releases the table/template refcounts only.

### Scale

- Payload is `end f32, time f32` (in that order, acclient.c:328805-328816). `SetScale`
  (acclient.c:328862-328903) interpolates **linearly from the object's current scale** to `end`
  over `time` seconds via the same self-removing FPHook mechanism as luminosity, with the
  familiar `0.0002` instant threshold. It writes one uniform scalar to the whole part array;
  per-part setup `default_scale` composes multiplicatively (acclient.c:313786-313797). Scale
  also feeds retail collision/selection spheres — presentation-only consumers can ignore that,
  but conservative bounds must track it.

### ReplaceObject

- **Retail has no `ReplaceObjectHook::Execute`.** Every other hook family defines one; type 5
  defines only ctor/pack/unpack/`GetSubDataIDs` (which preloads the replacement GfxObj,
  acclient.c:329556-329563). Exhaustive call-site search shows the part-mutation entry point
  (`CPartArray::SetPart`, acclient.c:313502-313527) is reached **only** from the
  ObjDesc/appearance paths, never from a hook. Firing the hook in retail does nothing visible.
  Faithful behavior is parse + preload + no-op; the _designed_ mutation (were it wired) would be
  `SetPart` → `SetGfxObjArray`, which swaps geometry/surfaces permanently, preserves scale and
  placement, and recomputes **no** bounds (retail's sorting/selection spheres come from the
  setup, not parts). Scope consequence recorded in Phase 4's decisions.
- Payload: **1-byte** part index + compressed 0x01-namespace DataID
  (`AnimPartChange::UnPack`, acclient.c:450404-450415). ACE's u16 read is suspect (recorded
  unknown; verify against real bytes before writing our decoder).

### Particles

- **Layout source:** ACE `ParticleEmitterInfo.cs:45-93` is the authoritative 0x32 stream order —
  retail's `UnPack` decompile is provably mis-based (acclient.c:312956) and must not be used for
  field order. `sorting_sphere` is not in the file; it is derived in `InitEnd` as
  `radius = max(max_offset, max_a × lifespan)` (acclient.c:312431-312445). `hw_gfxobj_id` is the
  particle mesh; `gfxobj_id` is parsed but never read anywhere in the particle path.
- **Emission:** `emitter_type` is a bitmask (`&1` per-second, `&2` per-meter). Per-second
  `birthrate` is a **minimum interval between emissions**, not a rate, and at most one particle
  emits per update tick — no catch-up (acclient.c:312447-312476, 318289). The per-meter predicate
  is unrecoverable from the decompile (IDA-flagged undefined operands, acclient.c:312468) and is
  a recorded unknown; ACViewer's guess is annotated `// verify` and is not evidence.
- **Randomization** (acclient.c:312311-312603): every rolled field is `RollDice(−1,1) × rand +
base` (addition, never multiplication); scale clamps to [0.1, 10.0], translucency to [0, 1];
  offset is a random unit vector projected perpendicular to `offset_dir`. The RNG roll order in
  `EmitParticle` is recorded (lifespan, finalTrans, startTrans, finalScale, startScale, C, B, A,
  offset) for bit-exact replication if ever wanted.
- **Coordinate space** (`Particle::Init`, acclient.c:317743-317915): the spawn frame is a copy of
  the parent's global frame (`part_index == -1` → object frame, else that part's frame). The hook
  `Frame`'s origin contributes to the offset; **its quaternion is never applied**. "Local" motion
  vectors (`LV`/`LA`/`LR` type names) are rotated into world space by the spawn frame; "global"
  vectors are raw. All particle state is world-space after Init. The 13 `ParticleType` motion
  formulas are pinned with line cites (acclient.c:317446-317664), including Explode's authored
  quirks (`c.y × a.x` on y, an extra `+ a.z` on z).
- **Following:** `is_parent_local != 0` re-reads the live parent frame every tick (particles
  rigidly follow); `is_parent_local == 0` uses each particle's spawn-time snapshot (particles are
  left behind) (acclient.c:318262-318273).
- **Lifecycle** (acclient.c:316606-316730, 317417-317444, 317935-317988): per-object
  `ParticleManager`; each emitter owns a hidden particle `CPhysicsObj` parented to the source.
  `emitter_id` semantics: 0 → auto-id (from 0xFFFF0000 up); nonzero → **replaces** any existing
  same-id emitter; the blocking variant instead refuses to create on collision; `DestroyParticle`
  / `StopParticle` hooks target by this id. "Persistent" means `total_particles == 0 &&
total_seconds == 0`. Stop (auto or hook) halts emission while live particles finish their
  lifespans, then the emitter self-reaps; `Destroy` and owner destruction vanish live particles
  instantly. Particles die **only** by lifespan; parts are pooled and reused.
- **Degrade** (acclient.c:305645-305662, 318189-318306): beyond the part's degrade distance
  (default 100.0) the emitter stops drawing and simulating; finite emitters still advance
  bookkeeping so bursts complete off-screen, persistent emitters freeze particle ages so nothing
  expires. This is presentation policy our renderer may re-express, but the
  finite-completes/persistent-freezes distinction is behavior to keep.
- **Billboarding exists — in the degrade layer, not the particle system (correction
  2026-08-06).** An earlier draft claimed retail has no billboarding; that was wrong. Every
  `CGfxObj` may carry a `DegradeInfo` id (0x11 family, DBObj type 26) authoring distance bands of
  `{LOD gfxobj, degrade_mode, distances}` (`CPhysicsPart::LoadGfxObjArray`,
  acclient.c:303404-303470). At draw time `CPhysicsPart::calc_draw_frame`
  (acclient.c:319260-319290 region) orients the part by the active band's mode: 1 = authored
  frame, **2 = full viewer-facing billboard** (`Frame::set_vector_heading` to the viewer
  heading), 3/4/5 = axis-locked viewer alignment about x/y/z (cylindrical billboarding). Because
  the draw frame is recomputed from the authored frame and then re-headed, **mode 2 overrides
  any `GR`/`LR` spin at draw time**. Particles are ordinary parts, so a particle whose
  `hw_gfxobj` authors mode 2 is a true camera-facing sprite — which matches observed retail
  footage. Consequences: the particle resource closure must include each `hw_gfxobj`'s 0x11
  dependency and its per-band LOD meshes, and the Phase 5 vertex stage needs the viewer-facing
  and axis-locked orientation branches, not only authored-frame transforms. (World objects use
  the same mechanism; our renderer ignores degrade info there **deliberately** — ratified
  2026-08-06: retail's LOD system is not being adopted, and a future custom LOD design owns that
  space. Particles are the one consumer where degrade _orientation_ is load-bearing.)
- **The 13 motion types collapse to 7 distinct position formulas (decoded 2026-08-06).** The
  `ParticleType` enum (acclient.h:3918-3934) and the `Particle::Update` switch
  (acclient.c:317446-317664) group as follows, which is the shape an implementation should take
  rather than thirteen separate cases:

  | Value(s) | `ParticleType`                                                   | Position formula                             | Shipped?  |
  | -------- | ---------------------------------------------------------------- | -------------------------------------------- | --------- |
  | 0        | `Unknown_PT`                                                     | none                                         | no        |
  | 1        | `Still_PT`                                                       | `parent + offset`                            | yes       |
  | 2, 12    | `LocalVelocity_PT`, `GlobalVelocity_PT`                          | `parent + offset + a·t`                      | yes       |
  | 3, 8, 10 | `ParabolicLVGA_PT`, `ParabolicLVLA_PT`, `ParabolicGVGA_PT`       | `parent + offset + a·t + ½·b·t²`             | 3, 8 only |
  | 4, 9, 11 | `ParabolicLVGAGR_PT`, `ParabolicLVLALR_PT`, `ParabolicGVGAGR_PT` | parabolic, plus authored spin                | yes       |
  | 5        | `Swarm_PT`                                                       | its own                                      | yes       |
  | 6        | `Explode_PT`                                                     | its own, with the recorded `c.y × a.x` quirk | yes       |
  | 7        | `Implode_PT`                                                     | its own                                      | yes       |

  The `Local`/`Global` split within a family does **not** change the position formula — it selects
  whether the authored vectors are rotated into world space by the spawn frame, which
  `Particle::Init` already does before `Update` runs (recorded above). So a `Local`/`Global` pair
  shares one evaluator and differs only in how its spawn constants were built. Likewise `GR`/`LR`
  select the spin axis space, not a different trajectory.

  Consequence for the GPU vertex stage: it implements **seven** position formulas and one
  orientation branch set, not thirteen, and `ParabolicGVGA_PT` (10) is unreachable in shipped
  content even though its formula is shared with two types that are reachable.

  The remaining three arms, transcribed 2026-08-06 from acclient.c:317601-317648. All are
  `parent + offset + f(t)`; only `f` differs:

  - **`Swarm` (5):** `x += cos(b.x·t)·c.x + a.x·t`, `y += sin(b.y·t)·c.y + a.y·t`,
    `z += cos(b.z·t)·c.z + a.z·t`. Note **`sin` on y but `cos` on x and z** — not a uniform
    circular sweep, and easy to "tidy" into one that would be wrong.
  - **`Explode` (6):** `x += (b.x·t + c.x·a.x)·t`, `y += (b.y·t + c.y·a.x)·t`,
    `z += (b.z·t + c.z·a.x + a.z)·t`. Both authored quirks confirmed: every axis multiplies by
    **`a.x`**, not its own component, and z carries an extra **`+ a.z`** inside the parenthesis.
    These read as bugs and must be reproduced exactly — authored content was tuned against them.
  - **`Implode` (7):** `pos += cos(a.x·t)·c + b·t²`, with the **same scalar `cos(a.x·t)` applied to
    all three axes**.

  Also transcribed from the same function's tail (acclient.c:317650-317664): scale and translucency
  both interpolate on `min(lifetime / lifespan, 1)` as `start + (final − start) · progress`, and the
  scale is written uniformly to all three axes. That is the per-particle animation the vertex stage
  owes alongside position, and it needs no extra state.

- **All 13 motion types are closed-form in elapsed time.** Every formula is
  `position = f(t, spawn constants, parent frame)` with no per-frame integration state — the
  same derive-don't-accumulate shape as the texture-scroll model. A particle's mutable state
  reduces to its spawn constants plus birth time; per-frame work is evaluation, not simulation.
  (The one accumulator is persistent-emitter lifetime under degrade, which is bookkeeping, not
  motion.)
- **ACViewer has a substantial C# port** (`ACViewer/Physics/Particles/*`,
  `Render/ParticleBatchDraw.cs`) — useful structurally, but **not faithful**: verified deviations
  include `InitEnd` emitting `total_particles` instead of `initial_particles`, inverted degrade
  logic, missing `GetRandom*` rolls, wrong A/B/C transforms for three parabolic types, and a
  self-recursive `CreateBlockingParticleEmitter`. Every borrowed detail must be re-checked
  against the retail cites above.

## North Stars

1. Implement measured authored effects before generic effect infrastructure.
2. Animation and physics scripts are independent clocks that dispatch the same prepared behavior
   command shape.
3. `EffectSystem` owns persistent implemented visual/material state only. A focused
   `BehaviorEventRouter` enters with `PhysicsScriptSystem`, when animation and scripts become two real
   producers targeting effect, particle, audio, structural, and chained-script consumers.
4. Preparation discovers and pins the complete transitive dependency closure before activation.
5. Cyclic dependency graphs are valid authored content; preparation termination and runtime
   repetition are separate concerns.
6. Effect instances follow current authored entity/part transforms published by
   `DynamicEntitySystem`; no standalone pose owner returns.
7. Unknown behavior fails staging or reports unsupported execution with complete provenance; it never
   disappears silently.
8. Script-only residents retain their static presentation until a real behavior consumer is ready.
9. Resource and runtime counts scale with unique assets and active effects, not source entities by
   accident.
10. Spawned-entity concerns do not enter this plan.

## Target Runtime Shape

```text
setup default script IDs
  -> typed content load
  -> prepared script repositories
  -> transitive hook/effect dependency closure
  -> per-entity PhysicsScriptSystem clock
  -> prepared behavior commands
  -> BehaviorEventRouter (introduced with the second producer and real consumers)
       |- persistent visual/material commands -> EffectSystem
       |- CreateParticle -> particle runtime -> renderer
       |- SoundTable / SoundTweaked -> AudioSystem
       `- CallPES -> scheduled script activation
```

Animation and script producers may target the same entity, but neither advances or owns the other's
clock. Animation-time replacement commands enter this same dispatch boundary after their immutable
part dependencies are staged. Equal-time ordering, reentrancy, teardown, and generation checks are
explicit. The router validates a generation-safe target, performs ordered synchronous dispatch, and
records one exhaustive outcome per command; it owns no clocks, queues, effect state, or resources.

### Convergence Debt Ledger

| Landed seam or debt                                                          | Why it is honest now                                                                                                            | Scheduled replacement                                                                                                                                                              |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EffectSystem.executeDepartedFrames` accepts animation-specific records      | Animation is still the only live producer                                                                                       | Phase 2 compiles one prepared command union; Phase 3 introduces the router and adapts animation                                                                                    |
| `PartRenderState` contains only translucency                                 | It has one real consumer and no speculative fields                                                                              | Phase 4 widens it only for proven scale/UV presentation facts                                                                                                                      |
| `ReplaceObjectHook` blocks animated activation                               | No replacement resources or bounds are prepared                                                                                 | Phase 4 unblocks activation: the hook decodes and reports intentionally-inert (retail-faithful)                                                                                    |
| Script-only authored residents retain static presentation                    | No script clock or effect closure exists                                                                                        | Phase 7 promotes them only after complete staged readiness                                                                                                                         |
| Particle and audio consumers are absent                                      | The app has no existing focused runtimes to reuse                                                                               | Phases 5 and 6 add named owners after Phase 1 evidence                                                                                                                             |
| Repository-wide Prettier has untouched baseline failures                     | Convergence formats every touched file without unrelated churn                                                                  | Convergence Phase 8, before this plan executes implementation                                                                                                                      |
| Activation-time `localBounds` do not account for a later `Scale` ramp        | No authored setup-default producer reaches a `Scale` hook in the measured slice, and published bounds are recomputed per sample | Phase 8 widens staged bounds by the maximum authored scale in the owner's script closure, which is knowable at preparation                                                         |
| `TextureVelocity` rates resolve per staged closure, not per activated script | All 11 authored hooks sit in setup-default closures that always play, so no shipped case is expected to differ                  | Phase 8 verifies the expectation against the landed workload; if any surface scrolls behind an unfired `CallPES` chain, resolve per activated script (storage model is unaffected) |

None of these debts requires a second entity runtime or blocks the spawned architecture design. The
first four are explicit implementation prerequisites before spawned entities may consume authored
behavior systems.

## Phased Implementation

### Phase 1: Complete the Authored Script and Hook Evidence

Progress: **Complete 2026-08-06.** Archive probe, five-track retail evidence sweep, representative
re-measurement, and the initial-phase replay decision are all recorded in Measured Workload,
Retail Execution Evidence, and Decisions below. Both scope questions were ratified 2026-08-06
(script tables move to the spawned plan, `ReplaceObjectHook` execution dropped). The fixture module
itself lands at the head of Phase 2 with the type it constructs; its contents are recorded here.

#### Deliverables

- Reproduce the recorded DA55/DC58 root IDs and transitive dependencies as checked-in, source-first
  fixtures; the archive-wide counts above are evidence, not runtime-asset test dependencies.
- ~~Prove record timing units, table keys/intensity selection, `CallPES` delay/repetition
  behavior, and equal-time command ordering from retail/ACE.~~ Done 2026-08-06; recorded in
  Retail Execution Evidence.
- ~~Inventory reusable audio, particle, material-animation, and asset-decoding code before
  designing consumers.~~ Done 2026-08-06; recorded in Existing Code to Extend. Audio is
  greenfield, particles reuse the instancing substrate, transport clones the animation lane, and
  a small clock unification is a new prerequisite for script clocks.
- ~~Prove the exact payload, dependency, coordinate/target, and lifetime semantics for the six
  unmet hook types in the measured table above plus the selected `ReplaceObjectHook` example.~~
  Done 2026-08-06; recorded in Retail Execution Evidence (including the `SoundTweaked`
  field-order trap and retail's missing `ReplaceObjectHook::Execute`).
- ~~Verify the derived-phase precondition: map the 11 `TextureVelocity` scripts to their
  referencing setups and confirm no GfxObj DataID is authored two different scroll rates.~~
  Done 2026-08-06 by the evidence probe; recorded in Measured Workload. No script-driven
  conflicts; the escape hatch stays unbuilt.
- ~~Decide from retail whether commands crossed during deterministic initial-phase replay are folded as
  persistent state, emitted as ephemeral effects, or deliberately skipped per command family.~~
  Decided 2026-08-06; see the replay policy in Decisions and Course Corrections below.

#### Runtime Verification Findings (2026-08-06)

- **Two integration defects surfaced only under a real browser**, neither reachable by static checks:
  1. The dev landblock content host served none of the four endpoints this plan added to
     `HttpLandblockContentSource`, so every harness run would have 404'd the moment a script
     activated. Nothing static covers the host and client agreeing on routes.
  2. Every particle draw raised `GL_INVALID_OPERATION` — a texture-format/sampler mismatch. WebGL
     validates **every active sampler** against its bound texture at draw time even when the shader
     branches away from it, so binding the palette unit only for paletted meshes left it holding
     whatever a previous pass had put there. `fakeGl` cannot catch this; only the harness can.
- Both are fixed, and the workload now runs with zero console errors.

#### Performance Regression: script-only promotion streams static residents per frame (2026-08-06)

Measured on `0xDA55FFFF` with buildings 4 / explicit 2 / generated 2 / env-cells 1, comparing
`--exclude-authored-dynamics` against a normal run:

| Measure                   | Without authored dynamics |       With |
| ------------------------- | ------------------------: | ---------: |
| Dynamic entities          |                        17 |        267 |
| Dynamic draws             |                         0 |      3,596 |
| Frame instance high-water |                     2,269 | **13,057** |

**Particles are not the cost.** A CPU profile of the regressed frame puts 62% in
`#drawOpaqueObjects` → `#prepareFrameInstanceRuns` → `formGroupedObjectInstanceRuns`, whose
per-batch-key run matching is linear; the particle pass does not appear. The 5.75× growth in the
frame instance arena is what pushed that grouping over.

**Cause: Phase 7 conflated "has timed behavior" with "needs per-frame presentation streaming."**
Of the 267 promoted residents, only **171 have animation playback** — the other **96 are script-only
and their parts never move**, yet every one is streamed into the frame instance arena every frame.
Retail enrols script owners through `AddStaticAnimatingObject` for _update_, not for rendering.

**The fix is a presentation/behavior split, and the condition is already knowable at preparation.**
A script-only resident needs per-frame presentation only if its closure authors a pose-changing
command (`Scale`, `SetOmega`, `TransparentPart`); the measured closure authors none, and archive-wide
only 43 `Scale` hooks exist. Everything else should keep baked static presentation and receive only
a script clock. That also resolves the recorded debt about script-only residents publishing no
presentation sample — it is the same distinction seen from the other side.

#### Acceptance Criteria

- Every implementation phase is backed by exact asset IDs, record shapes, and reference paths; the
  selected replacement fixture is `0x0300055B` part 1 / GfxObjs `0x01000BB4` and `0x01000BB5`.
- The three self-cycles inside the measured closure, the two roots that lead into a cycle rather
  than being one, and any additional cycles are recorded without being treated as corrupt content.
- Unknown payload boundaries or selection rules remain explicit blockers rather than guesses.

#### Decisions and Course Corrections

- **Convergence evidence:** The disposable full-archive script and animation census recorded above
  decoded through the existing closed hook parser and was removed after execution. It confirms that
  the next work is evidence completion, not another vocabulary or architecture discovery pass.
- **Scope correction:** Lighting is absent from the measured setup-default producer closure and is
  removed. `SoundTable`, `Scale`, and `TextureVelocity` are now explicit because the wider census
  proves they are real; the old representative-only summary hid them.
- **2026-08-06 evidence probe (temporary `effects_script_evidence` harness bin, removed after
  recording):** proved the 0x33/0x34 wire formats against ACE (`f64` start time + closed-vocabulary
  hook per script record; plain u32-count table dictionary), completed the constant-rate
  verification, decoded all six tables and their single referencing setups, surfaced mutual
  two-script `CallPES` cycles and in-the-wild `pause` usage, and confirmed sky
  `default_pes_object_id`s duplicate setup `default_script`s. Remaining Phase 1 work is the
  retail timing/selection/ordering evidence, the six unmet hook payload semantics, and the
  particle/audio/reuse inventory.
- **2026-08-06 representative re-measurement (temporary `effects_script_fixture_probe`, removed
  after recording):** the inherited 66/52 owner counts and their derived root/event/closure figures
  did not reproduce; the corrected census, the complete decoded closure, and the three findings it
  produced are recorded in Measured Workload. The correction is a scope _reduction_, not a gap: the
  same command vocabulary, cycle shapes, and attachment forms are all still present, in a smaller
  and now-reproducible set.
- **Fixture artifact deferred one phase, deliberately.** Phase 1 owns the fixture _contents_, which
  are now recorded above in full. The fixture _module_ lands at the head of Phase 2 alongside the
  `PhysicsScript` type it must construct, because there is nothing to compile against before then.
  No archive dependency survives either way.
- **Initial-phase replay policy (answers the last Phase 1 question; implemented in Phase 3).**
  Retail has no folding mechanism to copy — it replays overdue hooks in a burst and discards
  elapsed time above 2 s — so this is our design decision, constrained only by not contradicting
  observable retail behavior. Replay is per-family and exhaustive, with one outcome recorded per
  crossed command:

  | Family                                                                       | Replay behavior                                                                                                                                                                                   | Outcome                                              |
  | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
  | Persistent state (`Scale`, `TextureVelocity`, `SetOmega`, `TransparentPart`) | Applied with elapsed time accounted for: a ramp advances to its position at replay end rather than restarting                                                                                     | `folded-initial-state`                               |
  | Chained activation (`CallPES`)                                               | Executed, with the activation placed on the derived clock so the chain's phase is correct                                                                                                         | `executed`                                           |
  | Ephemeral (`SoundTweaked`, `SoundTable`)                                     | Suppressed                                                                                                                                                                                        | `suppressed-initial-state`                           |
  | Emitters (`CreateParticle`)                                                  | Delegated to the particle consumer, which owns the 0x32 asset and therefore the persistent/finite distinction: persistent emitters are back-dated, already-completed finite bursts are suppressed | `folded-initial-state` or `suppressed-initial-state` |

  Rationale for suppressing ephemeral commands: retail's 2 s cliff exists precisely to avoid an
  audible burst when a static object catches up, so suppression matches retail's intent while being
  exact where retail was accidentally correct. Rationale for delegating emitters: persistence is a
  property of the emitter asset, not the hook, so the router would have to re-derive a fact the
  particle consumer already owns — the same compute-once rule the texture-scroll model follows.
  **We deliberately do not adopt retail's 2-second cliff**, but not for the reason first written
  here. The original claim — that replay is O(records) regardless of elapsed time — holds for a
  single activation and is **false for chained scripts**: catching up a 2 s self-cycle across ten
  idle minutes is 300 sequential activations, not one. Corrected during Phase 3: catch-up is
  bounded by an explicit per-entity dispatch budget, and exhausting it **resynchronizes the entity's
  scripts to the current time and records a `resynchronized` observation with provenance**. That
  keeps retail's intent (do not replay unbounded history) while improving on its behavior in two
  ways: the drop is reported rather than silent, and the threshold is a work budget rather than a
  wall-clock cliff, so a cheap script survives a long stall that an expensive one does not. Folding
  whole cycles arithmetically would make even that budget unnecessary; it is a recognized
  optimization, deliberately not built, because the measured workload's shortest loop is 2 s and the
  budget already covers minutes of catch-up.

### Phase 2: Decode, Transport, and Prepare Script Resources

Progress: **Complete 2026-08-06.** Type check, lint, knip, Clippy, and all 678 frontend + 80 DAT
tests pass.

**Ratified 2026-08-06: script tables move to the spawned-entity plan.** Retail proves static
authored residents never perform a table lookup — the setup's `default_script` DID plays
directly, and every table-selection consumer is network-, collision-, or hidden-state-driven.
This phase is script-DID-only; the spawned plan inherits table decode, transport, and intensity
selection together with the recorded census and selection semantics.

#### Deliverables

- Add a typed `PhysicsScript` model in `holtburger-dat` using the proven layout.
- Expose typed content requests through `holtburger-content`/`holtburger-core` and compact Tauri
  transfer payloads.
- Add a typed script repository with shared in-flight preparation, ready/failed state,
  acquired handles, and deterministic release.
- Compile script and animation records into one immutable `PreparedBehaviorCommand` semantic union
  carrying target-relative values and source provenance, not producer-specific transport wrappers.
- Enumerate transitive dependencies with visited-set termination while preserving cyclic runtime
  edges.

#### Runtime Verification Findings (2026-08-06)

- **Two integration defects surfaced only under a real browser**, neither reachable by static checks:
  1. The dev landblock content host served none of the four endpoints this plan added to
     `HttpLandblockContentSource`, so every harness run would have 404'd the moment a script
     activated. Nothing static covers the host and client agreeing on routes.
  2. Every particle draw raised `GL_INVALID_OPERATION` — a texture-format/sampler mismatch. WebGL
     validates **every active sampler** against its bound texture at draw time even when the shader
     branches away from it, so binding the palette unit only for paletted meshes left it holding
     whatever a previous pass had put there. `fakeGl` cannot catch this; only the harness can.
- Both are fixed, and the workload now runs with zero console errors.

#### Acceptance Criteria

- Many owners referencing one script perform one transfer and preparation per unique asset.
- Entity sources retain script IDs rather than decoded timelines.
- Prepared script execution requires no DAT decoding, asset discovery, or frame-time I/O.
- Missing dependencies fail staging with full root/script/hook provenance.

#### Decisions and Course Corrections

- **Five hook payloads were typed in the DAT layer, not just the script ones.** `SoundTable` (2),
  `Scale` (12), `CreateParticle` (13), `CallPES` (19), and `SoundTweaked` (21) moved from
  `AnimationHookPayload::Raw` to typed variants. Animations and scripts share one hook vocabulary,
  so typing them once serves both producers and is what makes the single command union possible.
  `CreateParticle.part_index` is read as **`i32`**, not ACE's `u32`: retail branches on the `-1`
  whole-object sentinel and the archive authors it, so an unsigned read hides the only case that
  matters.
- **The transport is shared, not duplicated.** `behavior_hook_source.rs` owns one hook-payload
  manifest that both `animation_source.rs` and the new `physics_script_source.rs` project through,
  and the binary envelope writer was hoisted into `binary_source_record.rs` now that it has two
  callers. Net effect on the animation lane is a deletion.
- **Part-index validation is scoped explicitly, not defaulted.** `PartIndexScope` distinguishes
  `Known(count)` (animations, authored against one setup) from `DeferredToBinding` (scripts, which
  are authored independently of whichever object runs them). An implicit "skip if unknown" would
  have silently weakened the animation lane's existing check.
- **One `PreparedAssetRepository<TSource, TPrepared>` now backs both asset families.** The animation
  repository's 170-line lifecycle was becoming a second copy for scripts; it is now generic over
  load/prepare/label, and `AnimationAssetRepository` is a ~15-line subclass. Handle field
  `handle.animation` became `handle.asset` and the diagnostics keys lost their `animation` prefix;
  both were swept across every consumer.
- **`deferred-effect` and `unsupported-visual` collapsed into one `unimplemented` arm carrying
  `blocksActivation` as data.** The two arms only ever differed by whether they gated activation,
  which is a decision the decode layer can make once and record — the compute-once rule — rather
  than something consumers re-derive from the arm name. The blocking set is now one commented list
  of hook types whose absence costs an ambient effect rather than a correct drawing.
- **The redundant `hookType`/`payload.kind` agreement check was preserved deliberately.** Collapsing
  the payload switch initially dropped it and let a mismatched hook silently downgrade to
  `unimplemented`; a test caught it, and the check is now an explicit typed-hook table. Redundant
  transport facts exist to be cross-checked.
- **Script dependencies are derived, not transported.** A manifest-side dependency list could
  disagree with the records it describes, so `PhysicsScriptRepository` computes each script's direct
  `CallPES`/emitter/sound references from its own records.
- **Closure acquisition is all-or-nothing.** `acquireClosure` releases every handle taken so far if
  any dependency fails, so a half-staged closure can never reach activation. Traversal terminates on
  a visited set while the cyclic _runtime_ edges survive untouched in the records — proven by tests
  over the checked-in self-cycles and the two root-into-cycle chains.
- **Fixtures landed here as promised.** `authored-script-fixtures.ts` carries the measured
  representative closure as checked-in source with no archive dependency.
- **Deferred deliberately:** `tauri-physics-script-source.ts` was written and then removed. Nothing
  activates scripts until Phase 7, and an unwired adapter is dormant infrastructure that knip
  correctly flags. The host command (`load_physics_script`) exists and is exercised; the frontend
  adapter returns in the phase that consumes it.

### Phase 3: Execute Physics Scripts and Chained Scheduling

Progress: **Complete 2026-08-06.** Type check, lint, knip, Clippy, and all 696 frontend tests pass.

#### Deliverables

- Add `PhysicsScriptSystem` with independent per-entity clocks, generation-safe targets, and
  deterministic command crossing.
- Introduce `BehaviorEventRouter` at the first real multi-producer/multi-consumer cut. Adapt animation
  dispatch and script dispatch to its generation-safe synchronous command port without moving either
  producer's clock into the router.
- Implement the retail-proven equal-time producer order in the runtime tick and preserve authored
  order within each producer; the router records but does not invent temporal order.
- Schedule `CallPES` activations without synchronous recursive execution.
- Bound dispatch reentrancy independently of intentionally repeating scheduled scripts.
- Tear down clocks, queued commands, and acquired closures atomically with owner removal.

#### Runtime Verification Findings (2026-08-06)

- **Two integration defects surfaced only under a real browser**, neither reachable by static checks:
  1. The dev landblock content host served none of the four endpoints this plan added to
     `HttpLandblockContentSource`, so every harness run would have 404'd the moment a script
     activated. Nothing static covers the host and client agreeing on routes.
  2. Every particle draw raised `GL_INVALID_OPERATION` — a texture-format/sampler mismatch. WebGL
     validates **every active sampler** against its bound texture at draw time even when the shader
     branches away from it, so binding the palette unit only for paletted meshes left it holding
     whatever a previous pass had put there. `fakeGl` cannot catch this; only the harness can.
- Both are fixed, and the workload now runs with zero console errors.

#### Acceptance Criteria

- Known self-calling scripts repeat according to authored scheduling without infinite synchronous
  recursion.
- Large time steps neither drop nor duplicate timed commands.
- Animation and script clocks remain independently testable and cannot mutate one another.
- Removed/replaced owners cannot receive stale queued commands.
- Every dispatched command records exactly one executed, folded, deferred, or rejected outcome with
  producer asset, authored position/time, target identity, and generation.

#### Decisions and Course Corrections

- **Script clocks are wall-clock, not frame-cadence.** Retail anchors record times to
  `Timer::cur_time` and never sub-steps scripts, so `PhysicsScriptSystem` does not borrow the
  animation lane's fixed 30 Hz behavior step. The two systems share no clock in either direction.
- **Chained activation reproduces retail's drift-free concatenation.** An immediate `CallPES`
  starts the target at `caller.startTime + caller.lengthSeconds` rather than at the current clock,
  which is what makes a self-calling script repeat at exactly its authored length no matter how
  ragged the frame cadence is — proven by a test that advances on deliberately uneven steps.
  A nonzero pause instead rolls `roll() × pause`, with the roll injected so the runtime's randomness
  is explicit and tests are deterministic.
- **Activations and record dispatches interleave by time rather than draining in separate passes.**
  A chained script that begins mid-interval must run its own `t=0` records in the correct order
  relative to the caller's remaining records; two drain passes would have reordered them.
- **The catch-up claim from Phase 1 was wrong and is corrected in Measured Workload.** Replay is
  O(records) only for a single activation; chained scripts are inherently sequential. Catch-up and
  runaway are now bounded by one shared per-entity dispatch budget, and exhausting it resynchronizes
  the entity and reports it rather than silently discarding time.
- **`EffectSystem` became a pure consumer.** It no longer walks animation frames, filters hook
  direction, or records dispatch provenance; it implements `EffectCommandPort` and owns only the
  state commands mutate. Direction filtering moved to `AnimationSystem`, where it belongs: it is a
  property of animation playback with no counterpart in the script lane.
- **Consumers deliberately do not branch on dispatch mode.** An initial attempt made replayed
  translucency ramps snap to their endpoint; a pre-existing test caught it. A ramp is persistent
  state, so replay applies it normally and the remaining elapsed steps advance it to where it should
  be _now_ — which is not its endpoint if it was still in flight when the owner became observable.
  Only the recorded outcome distinguishes replay from live execution.
- **Targets are `(nodeId, generation)` pairs everywhere.** `DynamicOwnerInstallation` now exposes its
  generation so producers can stamp it, because node ids are recycled across generations and a
  queued command must never land on a successor. Liveness is checked before _every_ dispatch rather
  than once per batch, since a consumer reached earlier in the same batch may already have removed
  the target.
- **The router/script-system construction cycle is real, not accidental.** The script system both
  produces and consumes `CallPES`. Rather than make the router mutable or assert past an unset
  field, wiring goes through a holder; the runtime's own wiring throws until Phase 7 installs a
  script clock, so an unreachable path stays loud instead of silently no-op.
- **Diagnostics moved with the mechanism.** The Explorer's "hooks executed / deferred" row now reads
  the router's outcome counts as "commands executed / unconsumed"; `EffectSystem` diagnostics shrank
  to what it still owns.

### Phase 4: Implement Proven Visual Effect Commands

Progress: **Complete 2026-08-06.** Landed: the shared `textureScrollPhase` helper, the
`ReplaceObjectHook` ratification, the `Scale` consumer with its render-state widening, and the
preparation-time `TextureVelocity` rate resolution. The renderer binding for that rate moved to
Phase 7 — see the decision below.

**Ratified 2026-08-06: `ReplaceObjectHook` execution is dropped.** Retail has no `Execute` for
hook type 5 — the shipped client parses and preloads it, then does nothing, and the archive
contains exactly two records. Our runtime decodes the hook and reports it intentionally-inert
with provenance; no replacement resources are staged and the hook no longer blocks animated
activation. The two `0x0300055B` records become decode/inert-reporting fixtures.

#### Deliverables

- Implement measured `Scale` and `TextureVelocity` commands through narrow generation-safe ports.
  Preserve landed `SetOmega` and `TransparentPart` behavior while adapting their dispatch boundary.
- `TextureVelocity` uses the derived-phase model recorded in Measured Workload: the hook sets a
  static scroll rate on the content-identity material fact, and the renderer derives
  `phase = fract(rate × sharedClock)` at draw time. No scroll registry, no accumulator, and no
  per-entity scroll clock exist; seam synchronization across instances follows from shared rates
  and the shared clock. The sky pass already ships this derivation as `skyTextureOffset`
  (`webgl2-sky-pass.ts`) with unit coverage; hoist it to a shared helper both consumers call
  rather than duplicating the arithmetic. The phase-bias escape hatch is built only if Phase 1's
  constant-rate verification fails.
- Widen `EffectState`, `EffectPresentationSample`, and `PartRenderState` only with the exact scale or
  UV facts consumed in this phase; do not add luminosity, diffuse, lighting, or generic property bags.
- Decode `ReplaceObjectHook` records and report them intentionally-inert with provenance
  (retail-faithful; see the ratification above), unblocking animated activation for the two
  affected animations.
- Compose visual state through existing animation/template/dynamic-publication/render contracts.

#### Runtime Verification Findings (2026-08-06)

- **Two integration defects surfaced only under a real browser**, neither reachable by static checks:
  1. The dev landblock content host served none of the four endpoints this plan added to
     `HttpLandblockContentSource`, so every harness run would have 404'd the moment a script
     activated. Nothing static covers the host and client agreeing on routes.
  2. Every particle draw raised `GL_INVALID_OPERATION` — a texture-format/sampler mismatch. WebGL
     validates **every active sampler** against its bound texture at draw time even when the shader
     branches away from it, so binding the palette unit only for paletted meshes left it holding
     whatever a previous pass had put there. `fakeGl` cannot catch this; only the harness can.
- Both are fixed, and the workload now runs with zero console errors.

#### Acceptance Criteria

- Every proven visual command changes its named runtime consumer and is observable in a fixture.
- Commands perform no resource preparation during dispatch.
- `ReplaceObjectHook` records surface as intentionally-inert observations with full provenance,
  and animations carrying them activate normally.
- `BehaviorEventRouter` owns neither visual state nor template/resource lifetime; `EffectSystem` retains
  implemented visual state behind a narrow consumer port.
- Unsupported visual commands report source asset, record time, and target identity.

#### Decisions and Course Corrections

- **`skyTextureOffset` is hoisted, not copied.** It now lives in
  `renderer/texture-scroll-phase.ts` as `textureScrollPhase`, carrying the seam-synchronization
  rationale and the constant-rate precondition with it, and the sky pass calls the shared helper.
  The name lost its `sky` prefix because it now has two consumers.
- **`ReplaceObjectHook` no longer blocks animated activation.** Retail defines no `Execute` for hook
  type 5, so an owner carrying one renders identically whether we run it or not; withholding correct
  animation over it was strictly worse than reporting it inert. The router gained a distinct
  `intentionally-inert` outcome so the decision reads as a decision rather than as a gap.
- **The ratification's vocabulary was swept in the same change.** With `replace-object` no longer
  blocking, the blocking-hook diagnostic's `reason` field had exactly one reachable value, so it was
  removed rather than left as a constant. The test asserting the old blocking behavior was replaced
  by one proving activation proceeds, plus one covering a hook that genuinely would misrender.

- **`Scale` landed on the existing root-modifier seam.** `rootRotationModifier` widened into
  `rootTransformModifier` carrying rotation and uniform scale in one matrix, rather than gaining a
  parallel field: both are whole-object modifiers applied at the same seam, and a consumer needing
  them apart would only have to recombine them. Retail's "interpolate from the object's _current_
  scale" is reproduced, so a second command mid-ramp continues from wherever the first reached.
- **`TextureVelocity` resolves at preparation and reports `applied-at-preparation` at dispatch.**
  `resolveAuthoredTextureScroll` walks a staged closure once and returns its single whole-object
  rate. Conflicting rates within one closure **fail loudly** rather than taking retail's
  last-writer-wins: a derived phase cannot honor two rates, and the archive contains no such case,
  so a conflict is a content defect worth surfacing. `texture-velocity-part` is deliberately
  unhandled — the complete census found zero part-scoped scroll hooks anywhere — so that arm has no
  planned consumer rather than a deferred one.

- **The `TextureVelocity` renderer binding moved to Phase 7, on the no-dormant-infrastructure
  contract.** The mechanism is small and its shape is settled: add a `uTextureOffset` uniform to the
  object program (`vTextureCoordinate = aTextureCoordinate + uTextureOffset`, exactly as
  `webgl2-sky-program.ts` already does), carry `textureScrollRate` on
  `PreparedStaticObjectDrawCompatibility` so differing rates split into separate cohorts by the
  existing compatibility test, and set the uniform once per draw from `textureScrollPhase`. But
  **no authored resident runs a script until Phase 7 activates them**, so building it now would ship
  a uniform that is provably zero at every call site — dormant infrastructure this plan explicitly
  forbids. It lands with its producer instead. Phase 4 is complete without it: the rate is resolved,
  validated, and reported, which is the effects-side work.
- Conservative presentation bounds must track a `Scale` ramp's **maximum** extent. Published bounds
  are recomputed per sample so they already follow the current scale, but the activation-time
  `localBounds` staged by `prepareDynamicAnimation` predate any scale command and would under-bound
  a scaling object. Recorded as debt below.

### Phase 5: Add Authored Particle Fidelity

Progress: **In progress 2026-08-06.** Landed: typed 0x32 decoding with offsets verified against real
archive records, the content/transport/command lane, the frontend decode,
`ParticleEmitterRepository` with its exact preparation-time motion envelope, the complete
closed-form motion evaluator with a unit fixture per formula family, and `ParticleEmitterRuntime`
(emission cadence, lifetime, stop/destroy, emitter-id replacement, follow vs leave-behind, and
zero-cost hidden emitters with transition-time reconciliation), the router's particle port, the
emitter bounds contribution, and the GPU particle program with its closed-form vertex stage.
and the instance packing and cohort grouping the draw path consumes. **Effects-side work is
complete;** the renderer binding and its real-GPU verification move to Phase 7 with their producer —
see the decision below.

#### Deliverables

- ~~Prove particle-emitter asset interpretation, spawn timing, attachment/root selection,
  coordinate space, lifetime, material, blend/depth policy, and deterministic cleanup from
  retail/ACE.~~ Done 2026-08-06 (see Particles in Retail Execution Evidence); the sole residual
  unknown is the per-meter emission predicate, blocked on the decompile with no authored
  consumer identified. For blend selection, consume the shared `objectBlendPolicy`: retail
  particles are ordinary
  `CPhysicsPart`s in a particle `CPartArray` (`CPhysicsObj::makeParticleObject`,
  acclient.c:307921, via `CSetup::makeParticleSetup` and `CPartArray::InitParts`), so they draw
  through the same surface-flag blend staging as every other part — verified 2026-08-06, not
  inferred. Particle translucency animation (`Particle::Init` start/final translucency) modulates
  alpha on top of that surface-derived blend and remains this phase's own state.
- Handle root-relative emission: shipped `CreateParticle` events author `part=-1` (whole
  object/root) — the celestial script `0x330007DB` uses it exclusively — alongside part-indexed
  emission (`0x33000453` authors `part=0`).
- Add a focused particle asset repository if existing shared content primitives cannot represent the
  required immutable data.
- Add an app-local particle runtime whose mutable emitters/particles follow current entity or part
  transforms without entering `DynamicEntitySystem` ownership.
- **Visibility/culling strategy (ratified 2026-08-06), improving on retail's per-emitter model:**
  1. Cull at emitter granularity using a **preparation-time conservative bound** computed from
     the closed-form motion envelope — maximize `|offset + t·A + ½·B·t² (+ C terms)|` over
     `t ∈ [0, lifespan]` with the max rolls — once per unique emitter info. Retail's own derived
     sphere (`max(max_offset, max_a × lifespan)`, acclient.c:312431-312445) is velocity-only and
     provably under-bounds the parabolic types; ours is exact where retail guessed.
  2. The emitter bound composes into the owner's conservative presentation bounds exactly as
     animation bounds already do, feeding the existing visibility path; a culled emitter writes
     no instance records that frame. Transparent ordering uses the emitter bound center as the
     cohort sort key. No parallel culling system is built.
  3. **Never cull per-particle.** GPU evaluation means the CPU does not know per-particle
     positions; off-frustum particles of a visible emitter cost vertex-shader invocations and
     hardware clipping only. Per-particle CPU culling would reintroduce the ratified-out CPU
     ceiling.
  4. **Hidden emitters cost zero per tick.** Retail ticks hidden emitters every frame for
     bookkeeping (acclient.c:318219-318252); closed-form state replaces that with reconciliation
     at the visibility transition: persistent emitters shift live birth times by the suspension
     duration (retail's age-freeze, computed once), finite emitters compute hidden-interval
     emissions analytically (`elapsed / birthrate`, budget-capped) and their auto-stop, and a
     finite emitter's self-reap time is scheduled in advance rather than polled.
  5. Honor the authored degrade distance (from the same 0x11 info fetched for orientation) as
     the retail-parity distance cutoff in the per-emitter test; any future draw-distance quality
     knob scales it rather than replacing the mechanism.
- **Retail's draw mechanism is evidence, not prescription.** Retail renders every live particle as
  its own `CPhysicsPart` through the general per-part path; that fact pins the semantics (surface
  flags drive blend state, particles are GfxObj meshes, translucency animates per particle) but is
  a 2002 performance ceiling we deliberately do not inherit. Rendering uses renderer-owned
  batching/instancing — the natural shape is instanced cohorts per unique GfxObj/material, the
  same idea as the landed rigid-part instance cohorts — per contract 10 (renderer batching is
  renderer policy). The parity bar is visual output, never draw-call topology.
- **GPU evaluation is the design of record (ratified 2026-08-06).** The closed-form motion
  evidence reduces particle state to spawn constants plus birth time, so the instance record
  carries spawn constants and a dedicated particle _vertex_ stage evaluates
  `f(t, constants, parent frame)` on the GPU; per-particle CPU work is emission/kill bookkeeping
  only. Rationale: the static-authored workload alone is small, but this runtime is inherited by
  the spawned plan, whose script-table consumers (`Launch`/`Explode`/`Fizzle`) are combat spell
  effects — the architecture must not bake in a per-particle CPU ceiling. A CPU-evaluated path
  may serve as bring-up scaffolding but is not the landed end state.
- **Shader strategy: dedicated particle vertex stage, shared fragment chunks.** Particles are
  arbitrary in-world GfxObj meshes drawn with fog, depth, alpha test, and surface-derived
  blend — so the fragment side composes the existing object material chunks rather than growing
  a parallel "simple" particle shader back toward them. The vertex stage is particle-specific
  and covers both motion (spawn constants → `f(t)`, including `GR`/`LR` axis-angle spin) and
  orientation policy from the mesh's authored degrade mode: authored frame, full viewer-facing
  billboard (retail is eye-facing — basis from `normalize(cameraPos − particlePos)` — not
  screen-aligned), or axis-locked viewer alignment (see the billboarding correction in
  Particles; billboard modes suppress `GR`/`LR` spin exactly as retail's draw-time override
  does). Orientation mode is a per-mesh fact and cohorts are keyed by mesh, so it binds as a
  per-cohort constant, never a per-instance attribute. If the census confirms particle meshes
  author a single degrade band (expected), band selection is skipped and the base band's mode
  applies at all distances — consistent with the deliberate non-adoption of retail LOD
  elsewhere.
- **Two test sets, not one workload (ratified 2026-08-06, from measured coverage).** A temporary
  probe (removed after recording) decoded the seven emitter infos the measured representative slice
  reaches and compared them to the whole archive:

  | Measure                       | Representative slice      | Archive-wide                                               |
  | ----------------------------- | ------------------------- | ---------------------------------------------------------- |
  | Emitter infos                 | 7                         | 2,051                                                      |
  | Motion types (`ParticleType`) | 3 — types 1, 2, 5 only    | 11 — 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12                     |
  | `emitter_type`                | all `1` (per-second)      | per-second dominant; per-meter predicate still unrecovered |
  | Persistent emitters           | 7 of 7                    | 1,236 of 2,051                                             |
  | `is_parent_local`             | 0 in all 7 (leave-behind) | 814 of 2,051 follow                                        |

  The slice therefore exercises **three of the eleven motion types actually shipped**, zero finite
  emitters, and zero parent-following emitters. Validating this phase on the slice alone would ship
  eight untested motion formulas plus the entire finite-emitter and follow paths. Widening the
  slice is the wrong fix, because it conflates two obligations that want different tests:

  1. **Integration acceptance stays on the measured slice.** Attachment to the right root/part, the
     right authored time, correct placement and blend in a real scene — that needs a landblock you
     can look at, and eight events is enough for it.
  2. **Evaluation correctness gets unit fixtures per motion type**, checked against the retail
     formulas already pinned with line cites in Retail Execution Evidence, plus fixtures for the
     finite/persistent split and the follow/leave-behind split. These need no scene at all.

  This keeps North Star 1 intact — nothing is implemented that the archive does not author — while
  refusing to call eight formulas verified because three of them were. Note also that only 11 of the
  13 documented `ParticleType` values appear in shipped content: types 0 and 10 author nothing, so
  they are decoded and reported unsupported rather than implemented.

- Census the emitter-info `hw_gfxobj_id` population early in this phase — mesh, surface, and
  palette complexity **plus each mesh's 0x11 degrade info** (orientation modes and LOD bands
  actually authored) — to pin exactly which fragment chunks and orientation branches particles
  reach, the same evidence-first move the sky pass used to right-size its program.

#### Runtime Verification Findings (2026-08-06)

- **Two integration defects surfaced only under a real browser**, neither reachable by static checks:
  1. The dev landblock content host served none of the four endpoints this plan added to
     `HttpLandblockContentSource`, so every harness run would have 404'd the moment a script
     activated. Nothing static covers the host and client agreeing on routes.
  2. Every particle draw raised `GL_INVALID_OPERATION` — a texture-format/sampler mismatch. WebGL
     validates **every active sampler** against its bound texture at draw time even when the shader
     branches away from it, so binding the palette unit only for paletted meshes left it holding
     whatever a previous pass had put there. `fakeGl` cannot catch this; only the harness can.
- Both are fixed, and the workload now runs with zero console errors.

#### Acceptance Criteria

- All eight measured representative `CreateParticle` events produce attributable visible effects at
  the correct authored roots/parts and times, covering both `part = -1` and `part = 0` attachment.
- Every shipped motion type (1-9, 11, 12) has a unit fixture checked against its pinned retail
  formula, and the finite/persistent and follow/leave-behind paths each have one, independently of
  the scene workload. Types 0 and 10 author nothing in shipped content and report unsupported.
- Removing the source owner deterministically removes its emitters and particles according to proven
  lifetime semantics.
- Repeated emitters share immutable assets without sharing mutable particle state.
- Particle rendering preserves transparent ordering and does not fork scene-transform truth.

#### Decisions and Course Corrections

- **`ParticleMotion` distinguishes shipped from documented types.** Types 0 and 10 author nothing in
  the archive, so they decode as `Unshipped` and report rather than getting formulas written for
  them. Two fewer motion laws to implement and verify.
- **`EmitterTrigger` is modeled as the bitmask it is**, not an enum, with the unrecovered per-meter
  predicate documented at the point a consumer would reach for it.
- **`sorting_sphere` is deliberately not stored.** It is not in the file; retail derives it in
  `InitEnd` as `max(max_offset, max_a * lifespan)`, which under-bounds every parabolic motion type.
  Keeping retail's value would only invite a consumer to use a bound this phase already plans to
  compute exactly.
- **The exact envelope landed with the repository, not with the culling work.** `emitterEnvelopeRadius`
  bounds the A/B/C terms unconditionally rather than switching on motion type: bounding all three is
  conservative for every shipped type including those using only a subset, and a per-type bound table
  would have to be kept in step with the motion formulas forever. Randomized lifespan and scale
  contribute their maximum roll, matching retail's additive `RollDice(-1,1) * rand + base`.
- **Derived facts are computed host-side, once.** Persistence, both trigger bits, and whether the
  motion type is one shipped content authors are resolved during projection, so no frontend consumer
  re-implements retail's tests.
- **The motion evaluator landed as a pure CPU module ahead of the vertex stage.**
  `particle-motion.ts` implements all seven position formulas plus the clamped scale/translucency
  interpolation, with a unit fixture per family. This is the "evaluation correctness" half of the
  test split ratified earlier: it needs no scene, and it gives the eventual GPU port something exact
  to be checked against rather than eyeballed. The two authored `Explode` quirks and `Swarm`'s
  `sin`-on-y asymmetry each have a test whose stated purpose is to stop a later reader from
  "correcting" them.
- **`ParticleSystem` schedules and reaps; it never integrates.** Because motion is closed
  form, a live particle is spawn constants plus a birth time, so the runtime's whole job is
  emission cadence, expiry, and emitter lifetime. Retail's quirks are reproduced deliberately and
  each has a test: `birthrate` is a **minimum interval** with **at most one particle per tick and
  no catch-up** (bursting to fill a slow frame would change authored density), particles die only
  by lifespan, `stop` drains while `destroy` vanishes, and a nonzero `emitter_id` replaces a live
  same-id emitter while auto-id emitters stay independent.
- **The renderer binding and harness verification move to Phase 7, on the same contract that moved
  the `TextureVelocity` uniform.** Both need a live `ParticleSystem` producing cohorts, and
  `game-runtime` instantiates none until Phase 7 activates authored scripts — authored particles
  arrive only from physics scripts, so there is nothing to draw before then. Building the executor
  now would mean a draw path provably reached zero times, and verifying a shader against an empty
  scene proves nothing. Phase 5 owns the emitter semantics, the evaluator, the program, and the
  instance contract; Phase 7 owns making them visible.
- **Cohorts key on mesh _and_ motion type.** Motion type is a vertex-stage constant, so two
  emitters sharing a mesh but not a motion law cannot share a draw; keying on both makes that
  structural rather than a rule someone has to remember.
- **Instance records carry spawn constants, never evaluated positions.** A test asserts this
  directly, because the tempting shortcut — packing the CPU-evaluated position that `sample()`
  already computes — would silently reintroduce the per-particle CPU cost the GPU stage exists to
  remove.
- **`sample()` survives as the GPU stage's reference, not as a draw path.** It evaluates the same
  formulas on the CPU, which is exactly what the harness needs to check shader output against. Its
  docstring says so, so it does not read as a redundant second renderer.
- **The vertex stage interpolates its motion constants from `PARTICLE_TYPE`, not literals.** The
  GLSL and `particle-motion.ts` implement the same seven formulas, so the risk worth engineering
  against is drift between them. Interpolating the type values means a type added to the CPU
  evaluator without a matching shader branch fails a test rather than producing silently motionless
  particles. Same treatment for the orientation modes.
- **The billboard basis is eye-facing, not screen-aligned.** Retail re-heads the draw frame at the
  viewer _position_ (`Frame::set_vector_heading`), so the facing axis points at the eye rather than
  along the camera's forward vector; the two differ away from the screen centre. A degenerate basis
  (particle on the locked axis) falls back to the authored frame rather than emitting NaNs.
- **The CPU evaluator is the reference, and real-GPU verification is still owed.** `fakeGl` proves
  program creation and branch coverage but cannot prove the arithmetic. The browser harness runs
  real WebGL and is the right place to check shader output against `particle-motion.ts`; that
  verification is recorded as remaining work, not assumed.
- **The router delegates particle replay rather than deciding it.** Persistence is a property of the
  emitter asset, which the particle runtime owns and the router deliberately does not, so
  `create-particle` returns whatever the consumer did. This is the delegation the Phase 1 replay
  policy specified, now implemented rather than described.
- **An unstaged emitter reports `unprepared` instead of throwing.** A missing emitter is a staging
  gap the router records with provenance, not a runtime fault worth killing a frame over. The
  runtime instantiation in `game-runtime` lands in Phase 7 with activation, since authored particles
  arrive only from physics scripts and no resident runs one until then.
- **Hidden emitters cost nothing per frame, and the retail split is preserved.** A hidden emitter
  records when it was suspended and is not ticked at all; the interval is settled once when it
  becomes visible. Retail's own off-screen policy splits by persistence, and both halves are
  reproduced: a **persistent** emitter freezes particle ages (implemented as shifting every birth
  time forward by the suspension, which is an age freeze by arithmetic identity), and a **finite**
  emitter's hidden emissions are computed analytically as `elapsed / interval` capped by its
  remaining budget, so a burst still completes off-screen. This is point 4 of the ratified culling
  strategy, landed with the runtime rather than with the renderer.
- **A purely per-meter emitter emits nothing and says so.** The retail per-meter predicate is
  unrecovered from the decompile, so inventing a cadence would silently produce wrong density;
  emitting nothing is the visible failure.
- **Unshipped motion types return `null`, not a zero vector.** A zero vector would silently render
  particles at the world origin; `null` forces the caller to report.
- **A trigger-less emitter fails decode.** With neither bit set an emitter can never release a
  particle; that is a decode fault rather than authored content, and a silently dead emitter would
  be far harder to notice than a loud failure.

### Phase 6: Add Authored Sound Fidelity

Progress: **In progress 2026-08-06.** Landed: typed 0x0A `Wave` and 0x20 `SoundTable` decoding,
both verified against every record in the archive; the decoder-ready content/transport lane; the
spatialization math; `AudioSystem`; and the router's audio port. **Effects-side work is complete;**
the Web Audio device adapter and the `SoundTable` key resolution move to Phase 7 with their
producer — see the decisions below.

**Archive verification 2026-08-06** (temporary `sound_table_probe`, removed after recording): all
190 sound tables and all 786 waves decode with zero failures. Two findings change the shape of the
remaining work:

| Measure                    | Result             |
| -------------------------- | ------------------ |
| Sound tables decoded       | 190 / 190          |
| Waves decoded              | 786 / 786          |
| Keys with **1** candidate  | 4,183              |
| Keys with **2** candidates | **1**              |
| Wave formats               | 785 PCM, **1 MP3** |

- **Retail's never-select-the-last-candidate bug is very nearly moot.** Exactly one key in the
  entire archive authors more than one candidate, and with two candidates `floor(1 × roll)` is
  always 0 — so that single key always plays its first sound and its second is unreachable. The
  behavior is still reproduced (a one-key divergence is still a divergence), but no
  selection-strategy work is warranted beyond it, and the random-selection path is effectively
  decorative.
- **MP3 support is a one-asset problem.** 785 of 786 waves are PCM. That does not justify dropping
  MP3 — browsers decode it natively through `decodeAudioData`, so supporting both costs nothing —
  but it does mean the format branch needs no optimization and an unsupported-format report is
  genuinely an edge case rather than a likely path.

#### Deliverables

- ~~Prove `SoundTable` selection and `SoundTweaked` asset lookup, priority/probability/volume,
  spatial origin, attenuation, repetition, and teardown behavior from retail/ACE.~~ Done
  2026-08-06 (see Sound in Retail Execution Evidence), including the `SoundTweaked` field-order
  correction against ACE's naming.
- Add typed sound content decoding/transport and shared immutable audio asset preparation using
  existing facilities where available. Decode covers WAV and MP3 payloads (retail 0x0A carries
  both); an unsupported format is an explicit report, not a guess.
- Add **`AudioSystem`** (named per the frontend system convention alongside `EffectSystem` and
  `PhysicsScriptSystem`) consuming prepared sound commands and source transforms. The
  evidence-backed scope is deliberately minimal: one-shot fire-and-forget voices only — no
  looping, no streaming, no stop API, no mixing graph — with the probability gate and spatial
  parameters (flat-then-inverse-square gain with cutoff, heading pan) computed once at trigger
  and never updated. Voices deliberately outlive their emitting owner, matching retail.
  Retail's 16-voice priority steal is near-moot (hook sounds carry priority 0 and lose every
  contest), so a plain voice cap with oldest-steal is adopted as a recorded simplification.
- Make unsupported device/format/runtime failures explicit without blocking unrelated visual state.

#### Runtime Verification Findings (2026-08-06)

- **Two integration defects surfaced only under a real browser**, neither reachable by static checks:
  1. The dev landblock content host served none of the four endpoints this plan added to
     `HttpLandblockContentSource`, so every harness run would have 404'd the moment a script
     activated. Nothing static covers the host and client agreeing on routes.
  2. Every particle draw raised `GL_INVALID_OPERATION` — a texture-format/sampler mismatch. WebGL
     validates **every active sampler** against its bound texture at draw time even when the shader
     branches away from it, so binding the palette unit only for paletted meshes left it holding
     whatever a previous pass had put there. `fakeGl` cannot catch this; only the harness can.
- Both are fixed, and the workload now runs with zero console errors.

#### Acceptance Criteria

- All representative and selected fixture `SoundTable` / `SoundTweaked` events play the correct
  prepared sound with proven parameters and spatial origin.
- Repeated sounds share immutable decoded assets while retaining independent playback state.
- Owner removal and runtime shutdown stop or release sounds according to proven semantics.
- Audio failure is attributable and does not silently masquerade as successful hook execution.

#### Decisions and Course Corrections

- **A `Wave` record is not a `.wav` file.** It is a bare `WAVEFORMATEX` header plus payload, so
  handing it to a decoder unwrapped produces garbage. `to_riff` builds the container for PCM,
  truncating the AC header tail to RIFF's fixed 16-byte `fmt ` chunk exactly as retail's export
  path does; MP3 payloads are self-describing and bypass it, so callers branch on format rather
  than wrapping unconditionally.
- **An unknown format tag reports rather than assuming PCM.** Guessing would play noise instead of
  failing, which is much harder to notice than a missing sound.
- **Payloads are delivered decoder-ready.** PCM arrives RIFF-wrapped, MP3 untouched, so the
  frontend never learns what `WAVEFORMATEX` is. Container assembly is a fact of the source format,
  computed once at the host.
- **Spatial parameters are computed once at trigger time and never updated.** That is retail's
  behavior — a moving source does not re-pan — and it is also why audio needs no per-frame work.
  Panning is the source's projection onto the listener's right-hand vector, which is retail's
  heading-based pan without needing a heading angle.
- **Voices deliberately outlive their owners.** Retail's voices are fire-and-forget copies with no
  back-pointer, so a sound finishes after its emitting object is destroyed
  (acclient.c:366405-366407). `destroy()` exists for runtime shutdown only; calling it on owner
  removal would be a divergence rather than a cleanup, and the class docstring says so.
- **A plain oldest-steal replaces retail's priority stealing.** Retail runs 16 voices with
  priority-based stealing, but every hook sound carries priority 0 and loses every contest, so the
  priority machinery would be dead weight producing identical behavior.
- **A deliberately silent sound is `executed`, not `no-consumer`.** Losing a probability roll or
  falling below the audible floor is the system working correctly; conflating that with a missing
  consumer would hide real gaps behind expected silence.
- **Retail's selection bug is reproduced deliberately, and the census says why it barely matters.**
  See the archive verification above. Authored content was balanced against the bug, so "fixing" it
  would make a sound audible that no player has ever heard — but it reaches exactly one key.

### Phase 7: Activate Script-Only and Combined Authored Residents

Progress: **Complete 2026-08-06**, except the `TextureVelocity` uniform, which is deferred as a
render-contract change with no measured consumer (recorded below). Landed: script-closure, emitter,
and sound-table staging through the entity lifecycle; script clocks installed and advancing; the
Web Audio device; the particle runtime; the effect-state ownership move; script-only promotion;
`SoundTable` key resolution; and the complete particle draw path — mesh closure, decode, cache,
residency, instance buffer, pass, and frame wiring.

#### Deliverables

- Add the Web Audio device adapter implementing `AudioDevice`, and resolve `SoundTable` keys against
  the owning resident's installed table. Both are inherited from Phase 6 with their producer:
  authored sounds arrive only from physics scripts, and a `SoundType` key cannot be resolved without
  a resident that has a sound table installed.
- Bind particle draw cohorts through the renderer, inherited from Phase 5 with their producer:
  instantiate `ParticleSystem` in `game-runtime`, feed `collectCohorts` into an instanced
  draw using `webgl2-particle-program`, and compose `envelopeRadiusFor` into presentation bounds.
- Verify the particle vertex stage against `particle-motion.ts` on real WebGL through the browser
  harness. `fakeGl` proves the program links and branches; only the harness proves the arithmetic.
- Bind the `TextureVelocity` scroll rate through the object draw path, inherited from Phase 4 with
  its producer: `uTextureOffset` on the object program, `textureScrollRate` on
  `PreparedStaticObjectDrawCompatibility` so differing rates split cohorts through the existing
  compatibility test, and one `textureScrollPhase` call per draw.
- Stage complete script/effect closures before replacing retained static presentation.
- Atomically promote script-only residents into the shared authored dynamic aggregate.
- Activate animation and scripts independently for combined residents.
- Preserve authored placement, source ownership, template sharing, and conservative bounds.

#### Runtime Verification Findings (2026-08-06)

- **Two integration defects surfaced only under a real browser**, neither reachable by static checks:
  1. The dev landblock content host served none of the four endpoints this plan added to
     `HttpLandblockContentSource`, so every harness run would have 404'd the moment a script
     activated. Nothing static covers the host and client agreeing on routes.
  2. Every particle draw raised `GL_INVALID_OPERATION` — a texture-format/sampler mismatch. WebGL
     validates **every active sampler** against its bound texture at draw time even when the shader
     branches away from it, so binding the palette unit only for paletted meshes left it holding
     whatever a previous pass had put there. `fakeGl` cannot catch this; only the harness can.
- Both are fixed, and the workload now runs with zero console errors.

#### Acceptance Criteria

- No supported setup default-script resident remains inert or deferred.
- Script-only promotion never exposes a missing base presentation while dependencies prepare.
- Combined residents run both clocks without duplicate nodes/resources or coupled advancement.
- Owner eviction removes behavior, effects, queued work, nodes, and leases as one safe operation.

#### Decisions and Course Corrections

- **Effect-state lifetime moved from `AnimationSystem` to the entity owner, and had to.** A
  script-only resident has effect state and no playback, so installation could not stay coupled to
  animation without leaving that whole population unreachable. Two tests asserting the old ownership
  were replaced rather than propped up.
- **Promotion follows retail's own rule.** `InitDefaults` enrols a static object as animating for a
  default animation **or** a default script (state bits `0x40000` / `0x80000`,
  acclient.c:309131-309138), so only a resident with neither stays static. `PreparedDynamicAnimation`
  gained a `none` arm for "fully activated, nothing to play" — deliberately distinct from
  `retain-static-presentation`, where something _is_ being withheld.
- **The script system borrows its closure; the entity owns it.** Both released it at first, which
  double-releases on teardown. The acquirer must release it when preparation fails or is superseded —
  before any clock exists — so it cannot hand ownership away.
- **Emitter staging shares the closure's lane.** The emitter set is only knowable once the closure
  resolves, so a parallel lane could not express it; a partial failure releases what it already took.
- **Emitters need no removal path.** Destroying an owner's nodes stops them publishing a transform,
  which the runtime already treats as the emitter going away — behavior that was tested in Phase 5
  before it had a caller.
- **Particle mesh residency is fire-and-forget.** A resident activates immediately and its first
  particles may miss a frame or two while meshes land, which the draw pass counts as unresolved
  cohorts. Blocking activation on mesh residency would hold back correct script, audio, and
  animation behavior for a purely visual dependency.
- **Residency holds resource keys, not GL handles.** An earlier version cast keys straight to
  `WebGLTexture` and `WebGLVertexArrayObject`; it type-checked and was a lie. Keys resolve to live
  bindings only at draw time, so a mesh whose texture upload failed reports `null` and is counted
  rather than drawn untextured.
- **Particles draw after the blended pass**, because they are transparent and must not occlude the
  geometry they sort against.
- **Audio playback is best-effort.** An undecoded sound is skipped rather than queued: these are
  ambient one-shots tied to a moment, and playing one late is worse than not playing it.

#### Remaining Work

- Bind the particle draw cohorts through the renderer and verify the vertex stage against
  `particle-motion.ts` on real WebGL through the browser harness.

  Shape confirmed 2026-08-06, then **corrected the same day**. A particle mesh is a bare GfxObj, and
  the host already projects those: `ObjectResourceClosure::add_resident` dispatches on DID family
  and `add_gfx_object_definition` emits a complete one-part presentation (geometry, materials,
  appearance key) for the 0x01 case, which is the path direct-GfxObj residents already use in
  production.

  An earlier attempt added `resolve_gfx_obj_appearance` to `holtburger-content` before checking
  that. It was reverted: nothing called it, and it duplicated a proven path — dormant infrastructure
  by this plan's own contract. Recorded because the mistake is instructive, not because the code was
  interesting.

  **Landed since:** the host command and closure, the frontend decode, `ParticleMeshCache`,
  `WebGL2ParticleInstanceBuffer`, and `WebGL2ParticlePass` — one instanced call per cohort, with
  motion type and orientation bound as per-cohort constants and geometry resolution injected.

  **What remains is renderer residency plus the frame hookup**, and the pattern is exactly the sky
  pass's: `WebGL2Renderer` installs the sky's decoded closure once (uploading geometry and
  materials, `#skyPass` at webgl2-renderer.ts:1700-1712) and then resolves each object against it at
  draw time. Particles need the same three steps:

  1. An install path that uploads a `ParticleMeshPresentations` batch into renderer-owned geometry
     and material residency, keyed by `hw_gfxobj_id`.
  2. `ParticleDrawCohort[]` carried on the frame input, produced by `ParticleSystem.collectCohorts`.
  3. A `#drawParticles` call in `#drawView`, after `#drawBlendedObjects` — particles are transparent
     and must not occlude the blended pass they sort against.

  The pass itself needs no further change: it already takes a `resolveGeometry` callback, which is
  what step 1 supplies.

  Everything upstream of the draw is done: emitters stage, emit, expire, cull, and produce packed
  instance records with their motion type; the vertex stage exists and its formulas are pinned by
  the CPU evaluator's tests.

- Resolve `SoundTable` keys against the owning resident's installed table. This needs the setup's
  `default_sound_table` carried to the resident and the 0x20 table staged with the script closure;
  the decoder and its selection semantics already exist.

##### `TextureVelocity` binding is a render-contract change, not a binding (finding 2026-08-06)

Attempted and deliberately backed out. The shader uniform and the per-draw compatibility field are
both trivial, but the value has nowhere to come from: **GfxObj DataID does not reach the visual
template or the renderer at all.** The render world is keyed by material and appearance identity,
and `ResolvedMaterialFacts` carries DAT _surface_ facts, which a script-authored scroll rate is not.

So "keyed by GfxObj DataID" — the property that makes the derived-phase model correct, because it is
what keeps tiled instances in lockstep — requires threading a new source fact through the render
contract. That is a deliberate contract change, not a wiring step, and it should be scoped as one.

Weighing it: `TextureVelocity` has **zero occurrences in the measured representative workload** (11
scripts archive-wide, none in DA55/DC58), so nothing observable is waiting on it. The rate is already
resolved and validated at preparation by `resolveAuthoredTextureScroll`; only the render-side
consumption is outstanding. Building a constant-zero uniform now would be the dormant infrastructure
this plan forbids, so it waits for the contract change rather than being half-landed.

#### Recorded Debt

- A script-only resident publishes no presentation sample, so a script that authors `Scale`,
  `SetOmega`, or `TransparentPart` on one would mutate effect state nothing reads. No measured
  script does — the representative closure authors only `CreateParticle`, `SoundTweaked`, and
  `CallPES` — but 43 `Scale` hooks exist archive-wide, so this needs an effect-only sampling path
  before broader content activates.

### Phase 8: Resteer, Measure, and Clean Up

Progress: **Cleanup and resteer complete 2026-08-06.** Remaining: the runtime measurement items,
which need the browser harness against production content rather than static checks.

#### Task Checklist

- [x] Exercised the `0xDA55FFFF` script-owner workload through the browser harness against
      production content. **41 authored dynamic residents promoted**, 41 effect states installed,
      **87 dispatched commands across 10 distinct scripts** — 53 `create-particle`, 18
      `sound-tweaked`, 16 `call-pes` — with outcomes `executed: 71, scheduled: 16` and **zero
      console errors**. Scripts activate, chain, emit, and play end to end on real content.
- [ ] Measure script advancement, hook dispatch, particle simulation/upload/draw, audio asset/runtime,
      scene propagation, and teardown separately. The harness exposes `--profile-renderer` and
      per-system diagnostics; a timing pass needs `--gpu`, since SwiftShader numbers are not
      performance evidence.
- [x] Confirmed prepared resource counts track unique IDs rather than owners. `PreparedAssetRepository`
      shares one preparation per id across every acquirer, proven for scripts (two roots reaching one
      chained script transfer it once) and emitters, and `ParticleMeshCache` requests only meshes it
      does not already hold.
- [x] Confirmed cyclic scheduling stays bounded and observable. One per-entity dispatch budget covers
      both runaway self-calls and long-stall catch-up; exhausting it resynchronizes the entity and
      increments `resynchronizedCount`, proven by advancing a three-second loop across ten hours.
- [x] Deleted the deferral scaffolding: script-only residents now promote, `BlockingAnimationHook`
      (a hollow alias once the command union collapsed) is gone, the `deferred-effect` /
      `unsupported-visual` arms merged into one `unimplemented` arm carrying its decision as data,
      and the blocking-hook `reason` field went with the `ReplaceObject` ratification that left it
      one reachable value.
- [x] Examined `WebGL2InstanceBuffer` versus `WebGL2ParticleInstanceBuffer` and **did not collapse
      them.** They are different mechanisms, not one duplicated: the object buffer is a frame arena
      (`resetFrame` then `updateRange` writes into a shared allocation, exposing a binding), while
      the particle buffer uploads one whole cohort per draw. Forcing either model on the other would
      be worse than the ~15 lines of create/grow/delete they share, which is below the bar for an
      abstraction. The ledger's job was to force the look; the look says leave it.
- [ ] **Measure the particle buffer's per-cohort reuse.** Every cohort uploads into the same buffer
      immediately before its draw, so `bufferSubData` runs against a buffer with a draw already
      queued. That is correct, but the driver must either rename the buffer or stall. If profiling
      shows a stall, the fix is one allocation per frame with per-cohort offsets — the object
      buffer's arena model — not a second buffer. Noted rather than pre-optimized, per this plan's
      rule that structural change beats speculative micro-optimization.
- [x] Rename `ParticleEmitterRuntime` to `ParticleSystem`, with `ParticleSystemDependencies` and
      `ParticleSystemDiagnostics` and the module renamed to `particle-system.ts`. Every frontend
      system now follows the `<Concern>System` convention.
- [x] Confirmed no authored `TextureVelocity` surface scrolls behind an unfired `CallPES` chain.
      Probed 2026-08-06 over all 2,161 default-script roots and their 2,190-script closure: **all
      11 scroll-authoring scripts are setup default roots**, so every one activates the instant its
      resident does and the accepted early-scroll consequence is unreachable in shipped content.
      Verified rather than assumed, as the ledger required.
- [x] Updated architecture documentation (`apps/holtburger-3d/ARCHITECTURE_AUDIT.md` section 4) with
      the two-producer/one-union model, router ownership, and the structural frame-time-IO guarantee.
      The spawned-entity plan inherits it unchanged.
- [x] Ran the weather/sky-script plan's Phase R boundary dry-run
      ([holtburger-3d-weather-sky-script-runtime-plan.md](holtburger-3d-weather-sky-script-runtime-plan.md)).
      Verdict: the landed contracts host sky targets as an extension, with one identity decision
      recorded for that plan to make first. No sky-target support was pre-built here.

#### Runtime Verification Findings (2026-08-06)

- **Two integration defects surfaced only under a real browser**, neither reachable by static checks:
  1. The dev landblock content host served none of the four endpoints this plan added to
     `HttpLandblockContentSource`, so every harness run would have 404'd the moment a script
     activated. Nothing static covers the host and client agreeing on routes.
  2. Every particle draw raised `GL_INVALID_OPERATION` — a texture-format/sampler mismatch. WebGL
     validates **every active sampler** against its bound texture at draw time even when the shader
     branches away from it, so binding the palette unit only for paletted meshes left it holding
     whatever a previous pass had put there. `fakeGl` cannot catch this; only the harness can.
- Both are fixed, and the workload now runs with zero console errors.

#### Acceptance Criteria

- Representative authored scripts, particles, and sounds execute with proven timing and ownership.
- No correctness question is hidden by a no-op consumer or performance shortcut.
- The spawned-entity plan can reuse the landed behavior systems without alternate script/effect
  architecture.
- Formatting, lint, tests, Rust checks, Clippy, and visual/audio harnesses pass.

#### Decisions and Course Corrections

- Pending implementation.

## Verification Strategy

- Exact representative default-script root fixtures and complete transitive closures.
- Self-calling scripts and root-into-cycle chains proving finite preparation and scheduled runtime
  repetition.
- All eight `CreateParticle`, six `CallPES`, and five `SoundTweaked` measured representative events
  (see the closure table in Measured Workload), plus
  selected `SoundTable`, `Scale`, and `TextureVelocity` fixtures from the wider census.
- Independent animation/script clocks targeting one entity.
- Equal-time hook ordering and large-delta catch-up.
- Owner removal during preparation, dispatch, live particles, and live audio.
- Many owners sharing prepared scripts/effect assets with independent mutable state.
- Script-only and combined authored promotion.

Tests must use checked-in source-first fixtures. Temporary production-archive probes may establish
evidence but must be removed after results are recorded.

## Risks and Mitigations

### Effect Scope Expands Into a Universal Engine

Implement only behavior reached by the representative evidence set plus the explicitly required
`ReplaceObjectHook`. Add typed consumers per effect family and reject a generic effect graph,
property bag, or event bus without multiple proven producers and consumers.

### Cyclic Scripts Cause Infinite Preparation or Dispatch

Use visited-set dependency traversal for preparation. Runtime `CallPES` is scheduled work, not
synchronous recursive dispatch; bound per-tick work and report runaway scheduling with provenance.

### Particle or Audio State Pollutes Entity Ownership

Entities retain only typed contributions/handles needed for lifecycle. Particle and audio runtimes
own their mutable instances and receive generation-safe source/transform ports.

### Missing Consumers Are Reported as Success

Every prepared command has an exhaustive dispatch outcome. Unsupported behavior includes asset,
record, target, and reason; production acceptance forbids unsupported commands in the measured
workload.

### Effect Preparation Causes Frame-Time I/O

Stage complete transitive closures and pin their handles before activation. Script advancement and
hook dispatch consume prepared commands only.

### Script-Only Promotion Regresses Existing Static Rendering

Retain current static presentation until every required behavior/effect dependency is ready, then
swap atomically. Failure leaves the valid static presentation visible with diagnostics.

## Definition of Done

- [x] Every supported setup default physics script is decoded, prepared, and scheduled.
- [x] Intentional script cycles prepare finitely and execute through bounded scheduled repetition.
- [x] All measured visual, particle, audio, and chained-script commands have real consumers.
      `Scale`, `CreateParticle`, `SoundTweaked`, `SoundTable`, and `CallPES` all reach one.
      `TextureVelocity` resolves at preparation but its renderer binding is deferred — see the
      render-contract finding in Phase 7; it has **zero occurrences in the measured workload**.
- [x] `ReplaceObjectHook` records decode and report intentionally-inert with provenance, and
      animations carrying them activate normally (execution ratified out 2026-08-06;
      appearance-time `ObjDesc.anim_part_changes` is unaffected).
- [x] Script and animation clocks remain independent and deterministic.
- [x] Script-only and combined authored residents execute without duplicate presentation resources.
- [x] Effects follow current authored entity/part transforms and clean up with their owners.
- [x] Immutable behavior/effect assets are shared; mutable runtime state remains per activation.
- [x] No frame-time DAT decoding, dependency discovery, or asset preparation occurs. Enforced
      structurally: `getReady`, `ParticleMeshCache.get`, and `ParticleMeshResidency.resolve` all
      return `null` for an unstaged asset rather than starting a load.
- [x] Diagnostics distinguish prepared resources, active scripts, queued activations, particles,
      sounds, unsupported commands, and failures.
- [x] No spawned feed, motion-table resolver, or Explorer host is introduced as scaffolding.
- [x] All touched code passes repository formatting, linting, tests, Rust checks, and Clippy with
      warnings denied.
- [x] Architecture documentation describes the authored effects ownership and timing model
      (`apps/holtburger-3d/ARCHITECTURE_AUDIT.md` section 4).

## Open Questions

1. ~~Which of the six censused physics-script tables is the smallest fixture that still proves
   keys, modifier selection, fallback, and dependency closure?~~ Answered 2026-08-06:
   `0x340000BA` (see the table census in Measured Workload).
2. ~~What exact equal-time ordering does retail use across animation hooks, physics-script
   records, and chained `CallPES` activation?~~ Answered 2026-08-06 (see Script Execution and
   Timing): retail equal-time record order is undefined (broken qsort comparator); statics run
   scripts before this frame's animation hooks; `CallPES` never preempts the caller.
3. ~~Which particle asset fields and coordinate-space rules are required by every authored
   `CreateParticle` event?~~ Answered 2026-08-06 (see Particles): full 0x32 layout via ACE,
   world-space-after-Init rule, per-type local/global vector table, and emitter-id semantics.
   Remaining sub-unknown: the per-meter emission predicate (no authored consumer identified yet;
   blocked on the decompile, not on us).
4. ~~What sound-table/asset path, priority, probability, volume, attenuation, and lifetime
   semantics does retail use for `SoundTable` and `SoundTweaked`?~~ Answered 2026-08-06 (see
   Sound), including the field-order correction against ACE's naming.
5. ~~Which persistent commands fold into deterministic initial state, and which ephemeral audio
   or particle commands retail suppresses or emits when a static object starts at an independent
   phase?~~ Retail side answered 2026-08-06: scripts always start at phase 0 with no folding
   mechanism — retail replays overdue hooks in bursts up to a 2 s cliff and discards time beyond
   it. Initial-state folding is therefore purely our design decision, made in Phase 3 with no
   retail behavior to contradict.
