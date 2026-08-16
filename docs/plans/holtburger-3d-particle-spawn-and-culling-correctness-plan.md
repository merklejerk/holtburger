# Holtburger 3D Particle Spawn and Culling Correctness Plan

Status: Complete — implemented and verified 2026-08-15.
Created: 2026-08-15
Evidence refined: 2026-08-15

## Context and Boundaries

### Goal

Restore retail-correct per-particle randomization and replace the particle runtime's incomplete
unit-mesh culling estimate with one conservative geometric envelope that keeps every visible
particle submitted without retaining unrelated owners unnecessarily.

### Problem Statement

The particle spawn path currently conflates two different retail randomization laws. Motion
constants `a`, `b`, and `c` are authored as multiplicative ranges `[min, max]`, but the runtime
samples them through the symmetric additive helper used by lifespan variance. For waterfall mist
emitter `0x320004A3`, this changes its authored B multiplier from `[0.3, 0.7]` to `[-0.1, 0.7]`.
The negative tail reverses its authored downward acceleration, while the companion water emitter's
fixed `[0.5, 0.5]` range masks the same defect.

The spawn path also transports but ignores `scaleRand` and `transRand`. Retail independently
randomizes both endpoints of each appearance ramp and clamps the results. The runtime instead
copies the authored endpoints unchanged.

The culling path partially anticipates scale randomization by adding maximum scalar scale to the
emitter envelope, but it never reads the particle mesh's radius. This silently assumes every mesh
has unit radius. That result is published as a complete envelope, folded into both scene
broadphase and renderer presentation bounds, and used to retain or reject the emitter's entire
cohort. The abstraction therefore promises a geometric guarantee using an input contract that
cannot provide it.

### In Scope

- Retail-correct, independently sampled A/B/C multiplicative ranges.
- Retail-correct lifespan, start/final scale, and start/final translucency variance and clamps.
- A conservative local radius derived from the hardware GfxObj each particle draws.
- A complete emitter envelope composed from center reach, hook reach, mesh radius, and maximum
  attainable scale.
- Clean transport and prepared-runtime contracts that carry each derived fact once.
- Broadphase and presentation-bound propagation using the corrected envelope.
- Focused unit, lifecycle, archive-census, and browser-harness verification.
- Removal or correction of misleading unit-radius tests, comments, names, and metrics touched by
  the cutover.

### Out of Scope

- Changing particle motion formulas, orientation, blending, emission cadence, or lifecycle unless
  verification finds a direct dependency on the corrected spawn contract.
- Reproducing retail's known-underbounded particle sorting sphere. Holtburger retains its deliberate
  improvement, but makes the replacement genuinely conservative.
- Per-particle CPU culling or CPU trajectory integration. Motion remains closed-form in the vertex
  shader, with the CPU evaluator retained as its reference.
- Blocking script, audio, or effect activation on GPU mesh/material upload.
- General renderer spatial indexing or a particle-specific entity hierarchy.
- Runtime-asset-dependent tests in the checked-in suite. Production content belongs in disposable
  censuses and the browser harness.

## Ground Truth and Existing Precedent

### Authoritative References

- `acclient-eor-source/acclient.c:312311-312370`
  - `GetRandomStartScale` and `GetRandomFinalScale`: independent symmetric additive rolls, clamped
    to `[0.1, 10]`.
  - `GetRandomStartTrans` and `GetRandomFinalTrans`: independent symmetric additive rolls, clamped
    to `[0, 1]`.
  - `GetRandomLifespan`: symmetric additive roll, clamped to zero.
- `acclient-eor-source/acclient.c:312545-312601`
  - `GetRandomA`, `GetRandomB`, and `GetRandomC`: independent uniform multiplicative samples in
    their authored `[min, max]` intervals.
- `acclient-eor-source/acclient.c:317446-317664`
  - `Particle::Update`: closed-form trajectory laws and the parabolic `0.5 * b * t^2` term.
- `acclient-eor-source/acclient.c:317743-317913`
  - `Particle::Init`: local/global vector rotation and immutable spawn constants.
- `acclient-eor-source/acclient.c:318125-318158`
  - One independent random value is resolved for every spawn field before `Particle::Init`.
- `acclient-eor-source/acclient.c:312431-312445`
  - Retail's derived sorting sphere. It ignores acceleration, scale, and mesh geometry and remains
    a documented defect we do not reproduce.

ACE and ACViewer remain useful for DAT field names and structure, but the retail decompile is
authoritative for the randomization and motion behavior in this plan.

### Existing Code to Change

- `apps/holtburger-3d/src/lib/game/systems/particle-system.ts`
  - Spawn sampling, immutable particle records, emitter ownership, hook reach, owner aggregates,
    and cohort collection.
- `apps/holtburger-3d/src/lib/game/behavior/particle-motion.ts`
  - CPU reference evaluator; formulas should remain unchanged but supply verification samples.
- `apps/holtburger-3d/src/lib/game/behavior/particle-emitter-repository.ts`
  - Prepared emitter contract and current emitter-only envelope calculation.
- `apps/holtburger-3d/src-tauri/src/particle_emitter_source.rs`
  - Compact typed emitter transport. This is the preferred boundary for adding a conservative
    radius derived from the referenced hardware GfxObj without waiting for GPU residency.
- `apps/holtburger-3d/src-tauri/src/lib.rs`
  - Particle-emitter content request and runtime access to the referenced GfxObj.
- `apps/holtburger-3d/src/lib/assets/decode-particle-emitter-record.ts`
  - Typed frontend decode for the new mesh-radius fact.
- `apps/holtburger-3d/src/lib/game/behavior/particle-mesh-cache.ts`
  - Full mesh/material residency remains asynchronous and independent of semantic activation.
- `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts`
  - Existing propagation of one owner envelope into both culling bounds.
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts`
  - Non-blocking mesh staging and previous-selection particle cohort routing.
- Corresponding colocated tests and `apps/holtburger-3d/scripts/browser-harness.mjs`.

### Measured Archive Evidence

A disposable 2026-08-15 census over all 2,051 retail `ParticleEmitterInfo` records found:

| Measure                                                             | Count |
| ------------------------------------------------------------------- | ----: |
| Drawable emitters                                                   | 2,022 |
| Retail-inert zero-hardware-mesh emitters                            |    29 |
| Emitters with nonzero `scaleRand`                                   | 1,156 |
| Emitters with nonzero `transRand`                                   |   595 |
| Emitters with nonzero `lifespanRand`                                |   845 |
| Unique drawable particle meshes                                     |   342 |
| Emitters using a mesh radius greater than 1                         |   847 |
| Emitters using a mesh radius less than 1                            | 1,175 |
| Current fixed-scale emitters whose size term is underbounded        |   609 |
| Retail-scale-correct emitters whose size term would be underbounded |   834 |

Observed mesh radii span `0.0565685` through `1820.039`. The large tail includes long-form effect
geometry and proves that a unit-radius assumption cannot support a conservative archive-wide
contract; it does not by itself prove a visible pop without exercising the owning effect in scene.

The `0xF418FFFF` waterfall provides the focused production fixture:

| Setup/script                | Emitter      | Role        | Mesh radius | Relevant authored values                                                |
| --------------------------- | ------------ | ----------- | ----------: | ----------------------------------------------------------------------- |
| `0x02000859` / `0x330008A5` | `0x320004A3` | Mist        |    2.258871 | B = `(0,0,-40)`, B range `[0.3,0.7]`, scale `0.1 -> 3.2`, `scaleRand=2` |
| `0x02000859` / `0x330008A5` | `0x320004A2` | Main water  |    1.025914 | B range `[0.5,0.5]`, scale `6 -> 9`, `scaleRand=1`                      |
| `0x0200085A` / `0x330008A6` | `0x320004A4` | Short water |    1.025914 | B range `[0.5,0.5]`, scale `6 -> 9`, `scaleRand=1`                      |

The current mist envelope is `173.708927`. Its fixed rendered maximum scale requires a geometric
envelope about `2.028388` units larger at the conservative extreme. Retail-correct scale
randomization raises that deficit to about `6.546131` units unless mesh radius is incorporated.

### Plan-Finalization Evidence

A second disposable 2026-08-15 probe closed the metadata-source and preparation-cost questions.
It compared the maximum origin distance in each raw GfxObj vertex array with the maximum origin
distance in the exact polygon-expanded positions returned by production
`build_gfx_obj_geometry`:

| Measure                                 | Result |
| --------------------------------------- | -----: |
| Drawable particle meshes compared       |    342 |
| Exact radius matches within `1e-5`      |    342 |
| Raw radius larger than submitted radius |      0 |
| Submitted radius larger than raw radius |      0 |
| Empty prepared meshes                   |      0 |

This proves the cheap raw-vertex maximum is conservative and equally tight for every particle mesh
in the current archive. It does **not** claim the raw and submitted vertex sets are identical; only
the radius fact this plan consumes was compared.

One local development-profile run measured the following directional costs with fresh content
runtime caches (not a controlled cold-filesystem benchmark):

| Work                                                                       |    Elapsed |
| -------------------------------------------------------------------------- | ---------: |
| Decode the three waterfall emitter definitions and their referenced meshes |   1.536 ms |
| Decode all 2,051 emitter definitions                                       | 397.199 ms |
| Decode and fully prepare all 342 unique mesh geometries                    | 110.601 ms |
| Rebuild all 342 prepared geometries from the warm decode cache             |  29.554 ms |

These are not benchmark-grade latency promises. They are sufficient architectural evidence: the
focused dependency is small, raw-radius scanning is cheaper than the deliberately heavier full
geometry comparison, and no mesh-readiness repair protocol is justified up front.

The non-interactive browser harness also reproduced the current upward-drifting mist at a stable
fixed-time pose while retaining terrain and isolating authored dynamics:

```text
npm run harness:browser -- --brief --landblock 0xf418ffff --building-radius 1 \
  --explicit-object-radius 1 --generated-object-radius 1 --isolate-authored-dynamics \
  --camera-position 47020,178,-4680 --camera-yaw 0 --camera-pitch -15 \
  --particle-seed 7 --frame-interval-ms 33.333 --capture-frame 120 \
  --screenshot /tmp/f418-waterfall.png
```

At frame 120, the mist cohort is visibly separated above the upper water run, so the same pose can
verify the corrected downward arc without structure occlusion. Envelope-edge behavior remains a
separate synthetic selection fixture; camera composition should not be asked to prove two failure
modes at once.

## North Stars

1. Randomness is named by its distribution. A symmetric variance helper must never accept a
   `[min, max]` interval, and a uniform-range helper must never accept a base plus variance.
2. Every per-particle authored random field receives its own sample and is resolved exactly once at
   spawn.
3. A geometric bound contains geometry. Scalar scale without mesh extent is not particle size.
4. Semantic activation remains independent of GPU residency; correctness must not turn a visual
   upload into a script or audio barrier.
5. Derived facts live in the contract owned by the layer that has their inputs. Consumers do not
   re-derive mesh radius, maximum scale, or center reach.
6. Culling stays emitter-granular and analytic. No per-particle CPU simulation is introduced.
7. Both owner culls receive the same envelope, or the guarantee is incomplete.
8. Archive evidence selects fixtures and sizes risk; checked-in tests remain asset-independent.

## Design Decisions

### Split center reach from drawable extent

The emitter-only calculation becomes a particle-center reach. It includes maximum spawn offset and
the motion law's maximum displacement over maximum lifespan, but no particle mesh size. The final
drawable envelope is:

```text
hook reach + center reach + particle mesh radius * maximum clamped scale
```

The owner aggregate remains the maximum final drawable envelope among its live emitters.

### Carry mesh radius with the lightweight emitter asset

The preferred implementation extends the app-local particle-emitter host response with a
conservative radius derived from the referenced hardware GfxObj's vertex origins. This makes the
prepared `DrawableParticleEmitter` complete before script activation while leaving full geometry,
material, texture, and GPU installation in the existing asynchronous `ParticleMeshCache` lane.

This is a metadata dependency, not GPU residency. The archive-wide radius comparison and focused
load timing above support the direct contract; the plan does not introduce a second asynchronous
mesh-readiness/update path. Phase 2 still records implementation measurements so Phase 4 can catch
an accidental regression, but replacement now requires contrary landed evidence rather than being
an unresolved design branch.

### Preserve the deliberate culling divergence

Retail's sorting sphere is knowingly underbounded. Holtburger continues to derive a stronger bound,
so the existing `RETAIL DIVERGENCE` remains appropriate. Its comment must be updated with the new
formula, consequence, and refreshed archive census. Correcting spawn randomness is retail parity
and needs no divergence marker.

## Phased Implementation

### Phase 1: Correct immutable spawn sampling

Replace the overloaded random helper with distribution-specific primitives and make the spawn
record match retail before changing culling.

#### Deliverables

- Add honestly named pure helpers for:
  - uniform sampling in `[minimum, maximum]`;
  - symmetric additive variance around a base;
  - retail-clamped scale and translucency endpoints.
- Sample A, B, and C through the uniform-range helper.
- Independently sample and clamp start/final scale and start/final translucency.
- Retain symmetric lifespan sampling and its zero clamp.
- Keep all sampled values immutable in `ParticleSpawnConstants`; the CPU evaluator and shader
  continue to consume the same resolved record.

#### Acceptance Criteria

- A deterministic roll of `0`, `0.5`, and `1` maps `[0.3,0.7]` to `0.3`, `0.5`, and `0.7`.
- No A/B/C sample can leave its authored interval.
- Start and final appearance endpoints use distinct rolls and retail clamps.
- `0x320004A3`-equivalent test data always produces negative AC-Z acceleration.
- Particle-system unit tests, TypeScript checks, lint, and formatting pass.

#### Task Checklist

- [x] Replace `rolled` with distribution-specific helpers.
- [x] Cut A/B/C over to uniform interval sampling.
- [x] Implement scale and translucency endpoint sampling and clamps.
- [x] Add deterministic boundary and independent-roll tests.
- [x] Add a production-constant waterfall regression fixture without loading runtime assets.
- [x] Sweep comments and test names that describe the old sampling incorrectly.

#### Decisions and Course Corrections

- Completed 2026-08-15. Spawn now resolves fields in retail's observed order: lifespan, final/start
  translucency, final/start scale, C, B, A, offset, then motion-type initialization
  (`acclient.c:318125-318158`). Named locals make the sequence reviewable and keep JavaScript
  expression evaluation from owning compatibility behavior accidentally.
- The restored roll count exposed a brittle Explode test whose seven-value periodic source landed
  each particle on the same phase. Replaced it with a deterministic irrational-step source; no
  runtime concession or compatibility shim was retained.
- Verification: 45 focused particle-system tests, the complete TypeScript check stack, ESLint, and
  formatting passed.

### Phase 2: Make mesh radius a prepared content fact

Give the prepared emitter contract the missing geometric input without coupling activation to GPU
upload.

#### Deliverables

- Derive a conservative origin-centered radius for the referenced `hw_gfx_obj_id` from finite raw
  GfxObj vertex positions; the archive-wide production-geometry comparison validates this source.
- Extend the typed particle-emitter host record and frontend decoder with that named fact.
- Fail loudly for non-finite geometry, an empty drawable mesh where the renderer expects geometry,
  or a host/frontend identity mismatch.
- Keep retail-inert zero-mesh emitters inert without attempting a GfxObj read.
- Measure emitter preparation with cold and shared-mesh loads to verify decode-cache reuse.

#### Acceptance Criteria

- Radius derivation covers every vertex the particle renderer can submit, preserving the
  archive-proven raw/prepared maximum-radius equality.
- Two emitters sharing one hardware mesh observe the same derived radius without duplicate retained
  representations.
- Full particle mesh GPU installation remains fire-and-forget and may still trail activation by a
  frame or two.
- Host Rust tests, frontend decoder tests, lint, formatting, and type checks pass.

#### Task Checklist

- [x] Add the host-side mesh-radius derivation.
- [x] Extend the binary manifest and typed decoder.
- [x] Carry the radius through `DrawableParticleEmitter`.
- [x] Add zero, malformed, shared, smaller-than-unit, and larger-than-unit fixtures.
- [x] Record plan-stage cold/shared preparation measurements and select the preferred boundary.

#### Decisions and Course Corrections

- Plan-stage evidence selects synchronous lightweight emitter metadata. Do not add a live
  mesh-readiness envelope repair path unless landed implementation measurements contradict the
  evidence table above.
- Completed 2026-08-15. Collapsed the interdependent hardware ID and radius into one nullable
  `hardwareMesh { id, radius }` transport fact. `null` is exactly retail's zero-DID inert case; a
  drawable mesh cannot exist without its radius, so neither the decoder nor repository needs a
  fallback or assertion.
- The host validates the GfxObj family and returned identity, rejects empty/non-finite vertex data,
  rejects meshes without a structurally drawable polygon, and derives the radius in `f64` before
  proving it fits the transported `f32`. The shared content decode cache continues to own the one
  retained `Arc<GfxObj>` representation; semantic preparation still does not await material,
  texture, or GPU installation.
- Verification: 8 focused Rust tests, 66 focused frontend tests, the complete TypeScript check
  stack, ESLint, clippy with warnings denied, and app formatting passed.

### Phase 3: Compose one truthful drawable envelope

Cut over from emitter-only `envelopeRadius` to explicit center reach plus geometry-aware extent.

#### Deliverables

- Rename the emitter-only derived value to `centerReach` or an equally honest domain name.
- Compute maximum lifespan using the maximum attainable symmetric variance.
- Compute maximum scale as:

  ```text
  clamp(max(startScale, finalScale) + abs(scaleRand), 0.1, 10)
  ```

- Compose the final envelope with mesh radius and hook reach exactly once.
- Preserve the existing per-owner maximum and cold-path repair behavior.
- Publish the same corrected result into broadphase and presentation bounds.

#### Acceptance Criteria

- Synthetic meshes below, at, and above unit radius are conservatively bounded.
- Negative variance inputs, if retained by the decoded type, are bounded by magnitude rather than
  silently treated as zero.
- Starting or removing the widest emitter updates both culling bounds and owner aggregates.
- No particle-position evaluation or per-particle iteration enters the culling path.
- Particle, dynamic-entity, and render-selection unit tests pass.

#### Task Checklist

- [x] Split and rename center reach from final envelope.
- [x] Add clamped maximum-scale and maximum-lifespan helpers.
- [x] Compose mesh extent and hook reach into the final prepared contract.
- [x] Update owner aggregate and removal-repair tests.
- [x] Add a selection test whose owner proxy is outside view while its particle extent remains in
      view.
- [x] Update the `RETAIL DIVERGENCE` comment and archive evidence.

#### Decisions and Course Corrections

- Completed 2026-08-15. `DrawableParticleEmitter` now carries independently named `centerReach`,
  `maximumScale`, and one `mesh { id, radius }` composite. The activation layer owns the only final
  composition because it alone also knows the hook offset.
- Maximum lifespan uses `lifespan + abs(lifespanRand)`, and maximum spawn offset uses the largest
  absolute interval endpoint. The previous positive-only variance and `maxOffset`-only shortcuts
  were also non-conservative for valid decoded numeric shapes; fixing them required no new state.
- The existing owner maximum and cold removal-repair mechanism remained structurally valid. Both
  broadphase and per-pose presentation bounds still consume that one owner result.
- Added a scene-frustum selection fixture where the owner proxy is outside the plane and only the
  particle envelope crosses it. This directly proves selection rather than merely comparing
  expanded AABBs.
- Verification: 75 focused emitter, particle-system, and dynamic-entity tests, the complete
  TypeScript check stack, and ESLint passed.

### Phase 4: Resteer at the content/runtime boundary

Review the landed shape before browser work. The purpose is to verify that the implementation kept
the evidence-backed host metadata design cheap and did not accidentally couple it to GPU residency.

#### Task Checklist

- [x] Confirm the prepared emitter contains exactly the facts consumed by spawn, staging, and
      culling.
- [x] Confirm mesh radius is derived once and is not independently recomputed in the renderer.
- [x] Confirm semantic activation does not await texture or GPU upload.
- [x] Review preparation timings and cache behavior from Phase 2.
- [x] Dry-run Phases 5 and 6 against the landed contracts.
- [x] If contrary landed evidence rejects the metadata path, stop and amend this plan before
      replacing it cleanly; never retain both mechanisms.

#### Acceptance Criteria

- The remaining plan has one agreed source of mesh radius and one final-envelope owner.
- Any course correction is written into this section before further implementation.

#### Decisions and Course Corrections

- Completed 2026-08-15. The first prepared shape duplicated mesh identity/radius in authored
  `info.hardwareMesh` and top-level drawable fields. Resteering removed that smell: a drawable now
  contains authored `info` with the mesh decision removed plus exactly one `mesh { id, radius }`
  composite consumed by staging and culling.
- Semantic preparation awaits only emitter and GfxObj metadata. Committed mesh staging remains the
  existing tracked fire-and-forget continuation; scripts install without awaiting material,
  texture, renderer, or GPU readiness.
- A disposable landed-path timing probe measured the three waterfall emitter responses at 1.702 ms
  with a fresh content-runtime cache and 0.767 ms mean over 100 warm groups. This is directional
  development-profile evidence, not a latency budget, but it closely tracks the 1.536 ms plan-stage
  measurement and rejects the async repair branch.
- Dry-running Phases 5–6 found no new contract or sequencing gap. The production census can remain
  disposable, while the existing deterministic browser pose and synthetic selection test cover the
  two observable failure modes independently.

### Phase 5: Production-content and browser verification

Prove the corrected contracts against the waterfall and representative archive extremes.

#### Deliverables

- Re-run the archive census over all 2,051 emitter records using a disposable diagnostic or a
  generally useful retained debug-harness command.
- Recalculate under-bound counts using the landed radius and scale formula; expected count is zero
  for every drawable emitter.
- Use the non-interactive browser harness with deterministic particle seed and fixed simulation
  framing for `0xF418FFFF`.
- Inspect mist direction, arc, scale diversity, billboard orientation, blending, and owner-boundary
  visibility independently.

#### Acceptance Criteria

- Every `0x320004A3` B sample stays within `[0.3,0.7]`; none reverses gravity.
- Mist follows the same downward parabolic family as the larger water while retaining its authored
  spread and scale distribution.
- Main and short water gain authored size variation without trajectory regression.
- Moving the camera across the corrected owner envelope causes no whole-cohort pop while any
  particle geometry remains visible.
- Archive census reports no geometry-aware envelope under-bound.
- Browser console contains no new errors and particle mesh residency diagnostics settle.

#### Task Checklist

- [x] Re-run and record the archive census.
- [x] Discover and record a stable waterfall camera pose through harness diagnostics.
- [x] Capture deterministic before/after or corrected-state screenshots at fixed simulation times.
- [x] Exercise the envelope edge with a synthetic fixture if the production camera cannot isolate
      culling from portal selection.
- [x] Compare observable motion against retail footage or a user-observed retail run.

#### Decisions and Course Corrections

- Completed 2026-08-15. A disposable host exporter fed all real emitter responses through the
  production frontend decoder and prepared repository. Results: 2,051 emitters, 2,022 drawable, 29
  retail-inert, radii `0.05656854..1820.0391`, zero non-finite final envelopes, and zero geometric
  extent underbounds against an independently derived retail maximum scale. The exporter and
  census script were removed after use.
- The fixed pose at frame 120 provides a direct before/after comparison. The baseline contains the
  detached gray mist cohort arcing above the upper water; the corrected capture does not, while the
  main and short water cohorts remain present and gain their authored size variation. This matches
  the user's retail observation that mist follows the downward water arc.
- An untruncated deterministic rerun on isolated Vite port 1437 reported zero console messages,
  zero unresolved particle batches, 9 submitted particle batches, and 1,652 submitted instances.
  The first report-only retry was denied permission to bind the local content host; an approved
  rerun succeeded without code or configuration changes.
- Production framing isolates motion but not a single owner envelope edge. The Phase 3 synthetic
  scene-frustum fixture remains the stronger culling proof and avoids conflating portal selection
  with particle bounds.

### Phase 6: Cleanup and compatibility audit

Remove the vocabulary and tests that preserved the incomplete model, then close the compatibility
surface honestly.

#### Deliverables

- Delete the old overloaded random helper and unit-radius envelope assumptions.
- Replace tests that call scalar scale “particle size” without geometry.
- Ensure every new field has a named runtime consumer.
- Update particle comments, architecture notes, and retail behavior markers touched by the change.
- Run the full app-local validation suite and inspect the final diff for unrelated churn.

#### Acceptance Criteria

- `rg` finds no stale unit-radius, copied-random-endpoint, or old envelope terminology in surviving
  particle code and tests.
- No compatibility shim or dual envelope representation remains.
- Formatting, type checking, lint, unit tests, focused Rust tests, and browser harness all pass.
- The final diff changes no ACE, ACViewer, or retail decompile files.

#### Task Checklist

- [x] Sweep stale symbols, comments, tests, diagnostics labels, and docs.
- [x] Run app formatting, checking, linting, and unit tests through npm scripts.
- [x] Run focused Rust tests through the repository's package-manager workflow.
- [x] Run the final deterministic browser harness capture.
- [x] Record final decisions, concessions, measurements, and remaining debt in this plan.

#### Decisions and Course Corrections

- Completed 2026-08-15. Removed the overloaded random-helper vocabulary, the emitter-only envelope
  name, the unit-mesh assumption, duplicate prepared mesh facts, and all disposable census/timing
  probes. Surviving `hwGfxObjId` names belong to the separate particle-mesh transport and renderer
  batching contract; they are not remnants of the emitter-definition cutover.
- The completion audit tightened host validation: a nonempty vertex array is insufficient evidence
  of drawable geometry, so radius derivation also requires at least one polygon with three existing
  vertex references. This fails malformed content at the layer claiming the geometric guarantee
  and adds no runtime fallback.
- Final validation passed: 1,079 tests across 156 TypeScript test files; 120 Rust tests; Svelte and
  TypeScript checks; ESLint; dead-code analysis; clippy with warnings denied; Prettier; and
  `git diff --check`.
- A pre-commit code-quality review replaced the serializer's orphan `Option<f32>` radius parameter
  with the actual optional GfxObj. Mesh identity and radius derivation now stay coupled at the
  projection boundary, and a mismatched mesh is rejected by a reachable test.
- The same review removed a repository-level GfxObj-family check that duplicated the decoder's
  source-boundary validation and could only be tested by forging an already-decoded value. Radius
  narrowing now rounds upward when nearest-`f32` conversion would round down, preserving the stated
  containment invariant exactly rather than within floating-point tolerance.
- The final frame-120 browser capture at the recorded waterfall pose retained the corrected visual
  result, submitted 9 particle batches, and reported zero unresolved particle batches. The
  screenshot is disposable evidence at `/tmp/f418-waterfall-code-quality-final.png`, not a checked-in
  runtime-asset fixture.
- Concession: the host radius intentionally includes all raw vertices. Current archive evidence is
  exact for 342/342 drawable particle meshes; future unused outlier vertices could loosen culling
  but cannot underbound it. Re-running the raw/prepared census after archive changes is the named
  maintenance action. No implementation debt remains within this plan's scope.

## Risks and Mitigations

| Risk                                                                           | Consequence                                                  | Mitigation                                                                                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Host-side mesh-radius lookup adds behavior preparation latency                 | Script-only residents become slower to activate              | Fresh-runtime-cache evidence is 1.536 ms for the three waterfall emitters and meshes; remeasure the landed path at Phase 4       |
| A future archive adds unused raw vertices beyond submitted geometry            | Bounds stay safe but become unnecessarily loose              | Re-run the raw/prepared radius census when archive content changes; current coverage is 342/342 exact matches                    |
| An implementation makes mesh metadata arrive after an emitter becomes drawable | Bounds lag visible geometry and cohorts pop                  | Keep radius in the emitter preparation contract and fail preparation loudly; GPU residency remains a separate later event        |
| Correct random rolls alter deterministic harness sequences                     | Screenshots and particle layouts change beyond the waterfall | Assert semantic ranges and fixed-time properties; update deterministic evidence only after proving the new roll order            |
| Overlarge authored long-form meshes dominate owner bounds                      | Broadphase and footprint retention increase                  | Record archive extremes and validate them against actual submitted geometry; do not clip a valid mesh to improve culling numbers |
| Retail's own sphere appears smaller than the corrected result                  | A reviewer may “simplify” back to retail's defect            | Retain and strengthen the cited `RETAIL DIVERGENCE` with consequence and census                                                  |
| Portal-domain routing obscures a culling regression                            | A missing cohort is attributed to the wrong gate             | Pair production verification with a synthetic single-domain envelope-edge fixture                                                |

## Definition of Done

- [x] A/B/C use independent uniform `[min,max]` sampling.
- [x] Lifespan, scale, and translucency use independent retail symmetric variance and clamps.
- [x] No transported `scaleRand` or `transRand` field lacks its named spawn consumer.
- [x] Prepared drawable emitters carry a conservative radius for the mesh they name.
- [x] Final envelopes include hook reach, center reach, mesh radius, and maximum clamped scale.
- [x] Owner aggregates and both culling bounds consume the same final envelope.
- [x] Archive census finds zero drawable emitters whose geometry exceeds the corrected envelope.
- [x] The `0xF418FFFF` mist follows a downward arc and exhibits retail-style size diversity.
- [x] No whole emitter cohort disappears while its geometry remains visible in an exercised edge
      case.
- [x] Retail compatibility comments cite the decompile and current archive census accurately.
- [x] No runtime-asset-dependent test remains checked in.
- [x] App formatting, type checking, clippy-with-warnings-as-errors, unit tests, focused Rust tests,
      and browser-harness verification pass.
- [x] No unrelated files are staged or committed.

## Open Questions

None at plan-finalization time. Implementation measurements may still trigger an explicit Phase 4
course correction, but there is no unresolved design fork to carry into execution.
