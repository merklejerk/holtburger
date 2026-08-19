# Particle CPU Reduction: Placement-Read Diet, Closed-Form Reaping, and GPU Emission

## Context & Boundaries

**Goal:** Make particle CPU cost proportional to *visible* particles rather than *resident*
emitters, by removing per-frame placement resolution and reap scans now, and moving persistent
static-owner emitters to closed-form GPU emission after a content census.

**The reference pose.** Same C061 ground pose as the frame-input compilation plan, so numbers are
comparable across plans:

```
npm run harness:browser -- --landblock C061FFFF \
  --terrain-radius 8 --building-radius 8 \
  --explicit-object-radius 2 --generated-object-radius 2 \
  --camera-position 37008,46,-18672 --camera-yaw 45 --camera-pitch -2 \
  --viewport-width 1492 --viewport-height 952 \
  --gpu --profile-renderer --settle-ms 45000 --measure-ms 10000 --brief
```

Add `--particle-seed 7 --frame-interval-ms 16.667 --capture-frame 240` for screenshot parity and
`--cpu-profile <path>` for V8 self times. Hardware: AMD 7900XT via ANGLE; SwiftShader numbers are
not evidence.

**Motivating evidence (2026-08-19, the pose above, V8 CPU profile over 10 s / ~3,800 frames):**

- 626 live emitters across 492 owners, all persistent (0 reaped over the window), ~3,650 live
  particles — but only ~669 particles in 5 batches actually render. Over 80 % of resident
  emitters are culled every frame after paying full bookkeeping.
- `ParticleSystem.advance` ≈ 818 ms self /10 s: per-emitter loop plus the inlined `#reapExpired`
  filter (a fresh array per emitter per frame, ~2.4 M arrays /10 s) and `particleLifeProgress`
  for every live particle (~14 M divisions /10 s).
- `advance` resolves a full scene placement (`sceneOriginOf`) for every emitter every frame, used
  only for target-lost detection and the rare actual spawn. Placement resolution
  (`#sceneOriginOf` 454 ms + `SceneGraph.#resolvePlacement` 514 ms + `multiplyMat4` 417 ms self
  /10 s) is dominated by particle-triggered calls (~626 of ~800/frame); each call clones the
  local transform, multiplies per ancestor hop, clones the result again in
  `copyResolvedPlacement`, and allocates ~5 objects to deliver a translation.
- `collectCohorts` ≈ 430 ms self /10 s: rewrites 14 spawn-immutable fields per visible particle
  per frame into pooled records (the debt its own comment records).
- Particle-attributable total ≈ 2,700 ms /10 s ≈ **0.7 ms/frame** — the largest CPU consumer left
  in the frame after the frame-input compilation plan.

**In scope:**

- A read-only scene-graph translation query for per-frame origin consumers (the copy-on-read
  bystander), applied to `GameRuntime.#sceneOriginOf`.
- `ParticleSystem.advance` restructuring: lazy origin resolution, cheap target-liveness checks,
  spawn-time `deathTime`, in-place particle compaction, per-emitter earliest-death watermark.
- A DAT-wide emitter census (Rust, `holtburger-debug-harness` census bin) sizing the closed-form GPU emission design
  and its two retail divergences.
- Closed-form GPU emission for persistent, static-owner, interval-driven emitters with a global
  on-screen instance budget; CPU path retained for finite/burst emitters and following or
  rotating owners.

**Out of scope:**

- An affine `multiplyMat4` specialization — parked until Phase 4 re-measures what call volume
  survives the structural fixes (the remaining heavy caller is dynamics part-pose composition,
  which is a different plan's territory).
- Throttled off-screen advance — decided against (see Decisions): after Phases 2–3 an off-screen
  emitter's frame cost is a couple of comparisons, and GPU emission removes it entirely.
- Dynamic placement math (`dynamic-entity-system.ts`) entirely — its three placement reads were
  censused out of the translation query (see Decisions); their fix belongs to the named
  dynamic-placement follow-up.
- Per-particle spawn-record pooling refinements in `collectCohorts` — GPU emission supersedes
  them for the dominant population; re-evaluate the residue in Phase 4/7 with numbers.
- GPU-side particle costs (fill rate, vertex load); the sky pass; `emitsPerMeter` emitters
  (unrecovered predicate, currently never emit).

## Ground Truth

- `apps/holtburger-3d/src/lib/game/systems/particle-system.ts` — `advance`, `collectCohorts`,
  `#reapExpired`, `#emitDue`/`#emit`, `#reconcileVisible`, the injected dependency surface.
- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts` — `#resolvePlacement`,
  `getResolvedPlacement`, `copyResolvedPlacement`; the copy-on-read contract being bypassed for
  frame-rate reads.
- `apps/holtburger-3d/src/lib/game/runtime/game-runtime.ts` — `#sceneOriginOf`, `#originOf`,
  `#particleRenderOwner`, the `advance`/`collectCohorts` call sites in `render`.
- `apps/holtburger-3d/src/lib/game/behavior/particle-motion.ts` — closed-form motion laws; the
  CPU reference the GPU stage is checked against.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-particle-program.ts`,
  `webgl2-particle-pass.ts`, `particle-instance-stream.ts` — the existing GPU evaluation stage,
  instance layout, and per-frame upload the emission work extends.
- `acclient.c` — emission cadence quirk (312447-312476, 318289), spawn-order randomness
  (318125-318158), spawn-frame snapshot (317743), off-screen policy (305645-305662,
  318189-318306). Retail is the authority for what a divergence must cite.
- `crates/holtburger-dat/src/file_type/particle_emitter_info.rs` — Rust-side emitter decoding
  for the census.
- Existing precedent: `docs/plans/holtburger-3d-frame-input-compilation-plan.md` — the rate-tier
  methodology, harness A/B discipline, and guarantee-census cleanup style this plan continues.

## North Stars

1. Per-frame particle CPU scales with what is *drawn*, not what is *resident*. An emitter the
   camera cannot see costs at most a comparison.
2. Facts fixed at spawn are computed at spawn; facts fixed at emitter creation are computed at
   creation. The frame loop touches only genuinely frame-variant state.
3. Retail-faithful by default; divergence only where the census proves content cannot observe
   the difference, and every divergence carries its `RETAIL DIVERGENCE` marker, citation, and
   blast-radius census per the repo convention.
4. A hard, explicit budget beats an unbounded workload with soft costs. Losing the farthest
   particles under budget pressure is a feature, not a defect.
5. Reads scaled to their question: a consumer that needs a translation must not pay for a matrix
   clone. No defensive copies on frame-rate paths.
6. Failure stays loud: a broken contract (origin without rotation, budget accounting mismatch)
   throws at the boundary that owns it.
7. Measure with the established harness methodology: medians over repeated runs, real GPU,
   like-for-like poses, counts reported with timings.

## Phased Implementation

### Phase 1: Read-only scene translation query (the bystander)

`SceneGraph.getResolvedPlacement` exists for inspection and defensively copies; frame-rate
callers that need only a position re-derive a translation from two matrix clones and a full
compose chain. Give the scene graph a translation query that walks the parent chain transforming
a *point* (9 multiplies per hop, zero matrix allocations) and returns the resolved residency
alongside it, then route `GameRuntime.#sceneOriginOf` through it. Rotation reads
(`#sceneRotationOf`) stay on the copying path: they genuinely need the matrix and run only at
spawn.

**Deliverables:**

- `scene/scene-graph.ts`: a translation query (working name `getResolvedOrigin`) returning
  landblock-local translation plus `landblockId`/`envCellId`, allocation-free apart from the
  result. Doc comment names the contract difference from `getResolvedPlacement` (no matrix, no
  copies, frame-rate safe).
- `runtime/game-runtime.ts` `#sceneOriginOf`: consume the new query; keep the landblock-origin
  addition where it is.
- Tests: pin the new query's translation against `getResolvedPlacement().localToLandblock`'s
  translation over parented and root nodes, including an attached (child) node.

**Acceptance criteria:**

- Unit equality test passes; `svelte-check`, lint clean.
- C061 pose: `#resolvePlacement` + `multiplyMat4` self time measurably reduced with draw
  structure unchanged (this phase alone should roughly halve the placement-resolve bill since
  advance still calls per frame until Phase 2).

**Task checklist:**

- [x] Translation query implemented with residency in the result
- [x] `#sceneOriginOf` cut over
- [x] Equality tests over root, parented, and rotated/scaled ancestor chains
- [x] Harness A/B recorded in Decisions (folded into the Track A measurement)

### Phase 2: Lazy origin in `ParticleSystem.advance`

`advance` needs an origin only when a particle actually spawns; target-lost detection needs only
liveness. Restructure so the per-emitter frame path performs no placement reads at all.

**Deliverables:**

- `systems/particle-system.ts`: `advance` checks target liveness via a new injected
  `targetLives(target): boolean` (backed by scene-node existence plus the sky-target registry in
  the runtime — the same residencies `#originOf` consults, minus the resolution); origin is
  resolved inside the emission path only after the interval gate and population cap pass.
- `runtime/game-runtime.ts`: provide `targetLives`; dependency doc comments updated so
  `sceneOriginOf` is named as spawn-tier, not frame-tier.
- Tests: emitter removal on target loss still exact; an emitter that is not due to emit performs
  zero origin resolutions (dependency call counting, which the injected-function design already
  supports).

**Acceptance criteria:**

- C061 pose: `sceneOriginOf`-attributed self time from particles drops to spawn-rate volume
  (hundreds of calls per *second*, not per frame); `particleAdvance` tick phase mean reduced.
- Particle diagnostics (emitter/particle counts, emitted totals) unchanged at the pose.

**Task checklist:**

- [x] `targetLives` dependency added and wired
- [x] Origin resolution moved inside the emission path
- [x] Call-count tests for the zero-resolve frame path
- [x] Harness A/B recorded in Decisions (folded into the Track A measurement)

### Phase 3: Closed-form expiry

Expiry is fully determined at spawn (`birthTime + lifespan`), yet today every particle pays a
division per frame and every emitter a filter allocation. Store `deathTime` at spawn, compact
in place, and keep a per-emitter earliest-death watermark so the common frame is one comparison.

**Deliverables:**

- `systems/particle-system.ts`: `LiveParticle` gains `deathTime`; `#reapExpired` becomes an
  in-place compaction that runs only when `timeSeconds >= instance.nextDeathTime`; the watermark
  is maintained at spawn, reap, and in `#reconcileVisible` (which shifts `birthTime` and must
  shift `deathTime` and the watermark by the same suspension).
- `particleLifeProgress` remains the motion/appearance evaluator's business; the reap path stops
  calling it.
- Tests: reap exactness against the old predicate across lifespans including zero; the
  suspension shift keeps `deathTime` consistent; watermark short-circuit verified by call
  counting.

**Acceptance criteria:**

- C061 pose: `advance` self time reduced to interval/cap bookkeeping; measured GC /10 s reduced
  (the filter arrays and placement copies from Phases 1–2 are the last big per-frame allocation
  sources in this system).
- Particle populations bit-identical over a seeded run (same seed, same counts each frame).

**Task checklist:**

- [x] `deathTime` at spawn; reap by comparison, compaction in place
- [x] Watermark maintained at all four mutation sites (create, spawn, reap, reconcile)
- [x] Reconcile-shift consistency test
- [x] Harness A/B recorded in Decisions (folded into the Track A measurement)

### Phase 4: Re-measure & resteer

- Re-run the C061 pose (medians of 5, real GPU): CPU phase means, particle-attributed self
  times, GC, populations. Record against the Phase 0 numbers above.
- Ask the user for an explorer-in-Tauri spot check (JavaScriptCore amplifies exactly the
  allocation-heavy work Phases 1–3 delete).
- Decide with numbers: is the affine `multiplyMat4` specialization still worth anything for the
  surviving callers? Is the `collectCohorts` record refill (~0.11 ms/frame) worth an interim fix,
  or does Track B's timeline make it dead work?
- Dry-run Phases 5–7 against what the code now looks like.

**Task checklist:**

- [x] A/B table recorded in Decisions
- [x] Parked items decided with numbers
- [x] Phases 5–7 dry-run and steered

### Phase 5: Emitter census & divergence ratification

The GPU emission design (Phase 6) is only exact for emitters whose behavior is closed-form.
Census the authored corpus before building, and put the two divergences in front of the user
with their measured blast radius.

**Deliverables:**

- A census tool in `holtburger-debug-harness` (`src/bin/particle_emitter_census.rs`) over every `ParticleEmitterInfo` in portal.dat reporting
  distributions of: `birthrateSeconds` (flagging sub-16.7 ms cadences, where retail's
  one-per-update quirk visibly rate-limits), `lifespan ± lifespanRand`, `maxParticles` vs the
  alive-window bound `ceil(maxLifespan / birthrate)` (flagging cap-binding emitters),
  `initialParticles`, `totalParticles`/`totalSeconds` (finite population), `isPersistent`,
  `followsParent`, and motion-type counts. Results recorded in Decisions.
- Written `RETAIL DIVERGENCE` drafts, each with citation and census-sized blast radius:
  1. Emission cadence decoupled from frame rate (vs acclient.c:312447-312476 one-per-update).
  2. Cap-binding emitters truncate their alive window instead of delaying births
     (vs retail's skip-while-at-cap).
- A decision on parity methodology: `--particle-seed` drives injected CPU rolls; hash-driven GPU
  spawns need either a seeded hash the harness can pin or a population/structure-metric parity
  standard for particle scenes.

**Acceptance criteria:**

- Census results and both divergence write-ups recorded in Decisions (census and the
  cap-clamp direction already resolved — see Decisions); user sign-off on the parity standard
  **before Phase 6 begins**.

**Task checklist:**

- [x] Census tool and results in Decisions (gathered early, 2026-08-19)
- [x] Divergence write-ups drafted (approval pending with the parity standard)
- [ ] Parity methodology decided

### Phase 6: Closed-form GPU emission with a global on-screen budget

For persistent, static-owner, interval-driven emitters: births occur at `phase + k · interval`;
particle `k`'s lifespan, scale/translucency endpoints, offset, and a/b/c samples derive from
`hash(emitterSeed, k)`; the spawn-frame rotation is constant and bakes into per-emitter
constants at creation. At time `t` the alive set is a contiguous window of `k`, bounded by
`min(ceil(maxLifespan / interval), maxParticles)` — a fixed per-emitter instance count. Upload
per-emitter static data once at creation; per frame, CPU work is: cull to visible emitters,
sort farthest-last, prefix-sum bounds, cut at the global budget, draw.

Finite/burst emitters and emitters whose owner actually moves or rotates stay on the (now
cheap) CPU path. `followsParent` is not itself disqualifying: for a static owner, following and
frozen origins are indistinguishable, so eligibility is owner staticness + persistence +
interval-driven — the census's 614 shape-eligible definitions are a floor, not the gate.

**Deliverables:**

- Shader-side generation logic in `webgl2-particle-program.ts` (or a sibling program): in-shader
  PRNG hash, per-generation constant derivation, alive-window discard, reproducing
  `particle-motion.ts` semantics; the CPU evaluator remains the checked reference.
- Per-emitter static instance regions with creation-time upload; a residency/eviction story tied
  to emitter lifetime (creation, destroy, target loss).
- Runtime split: closed-form-eligible emitters leave `advance`'s per-frame loop and
  `collectCohorts` entirely; eligibility decided once at creation from the emitter info.
- Global instance budget: a named frontend tuning constant; farthest-first emitter-granularity
  truncation; budget pressure surfaced in particle diagnostics (eligible vs drawn instance
  counts, truncated emitter count).
- Harness scenario exercising budget truncation and the CPU/GPU population split; diagnostics
  extended so both populations are visible.

**Acceptance criteria:**

- CPU reference vs GPU output pinned for the closed-form population (per the Phase 5 parity
  standard).
- C061 pose: particle-attributable CPU scales with visible emitters only; per-frame
  `bufferSubData` volume for the closed-form population is zero in steady state.
- Budget scenario: truncation drops farthest emitters first, diagnostics account for every
  eligible instance, no over-budget draw.
- All existing particle scenarios (seeded captures, portal path, sky) still pass.

**Task checklist:**

- [ ] In-shader generation with pinned CPU-reference parity
- [ ] Creation-time upload and lifetime-tied eviction
- [ ] Eligibility split at creation; eligible emitters out of the frame loop
- [ ] Budget with diagnostics and harness scenario
- [ ] Divergence markers landed with census citations
- [ ] Harness A/B recorded in Decisions

### Phase 7: Cleanup & guarantee census

- Sweep vocabulary: the `collectCohorts` "measured debt" comment, any "reap" naming that no
  longer scans, dependency doc comments describing the old call rates.
- Delete dead paths: per-frame refill/upload code that only the closed-form population used,
  interim diagnostics that report a permanent zero.
- Verify every guarantee of the deleted per-frame mechanisms against its named replacement:
  - per-frame origin freshness (advance) → spawn-time resolution + `targetLives`
  - per-frame reap exactness → `deathTime` watermark + compaction
  - per-frame upload freshness (closed-form population) → creation-time upload + eviction on
    emitter lifetime events
  - per-frame population cap (`maxParticles`) → alive-window clamp (divergence-marked)
  - unbounded draw volume → global budget with diagnostics

**Task checklist:**

- [ ] Vocabulary and dead code swept
- [ ] Guarantee/replacement census verified and recorded in Decisions

## Risks & Mitigations

- **Hash-driven randomness looks wrong** (banding, visible repetition vs retail's LCG streams):
  pick a proven integer hash (e.g. PCG-style) and eyeball A/B captures of dense emitter scenes
  during Phase 6; the CPU reference makes distribution tests cheap.
- **Divergence blast radius underestimated** (an authored effect that depends on cap-delay or
  frame-coupled cadence): the Phase 5 census flags exactly those emitters; any flagged emitter
  can be routed to the CPU path instead of diverging.
- **`deathTime`/reconcile inconsistency** (suspension shifts `birthTime` but not `deathTime`,
  silently extending lifetimes): consistency test in Phase 3 targets that exact seam.
- **Budget popping** (emitters at the budget boundary flickering as the camera moves): emitter-
  granularity truncation plus a generous default budget; if flicker is observed, add hysteresis
  then, not preemptively.
- **Translation query drifts from `getResolvedPlacement`** (two code paths answering "where"):
  both walk the same parent chain in the same module; the equality test pins them, and the
  copying API remains the only source of full transforms.
- **Portal/interior routing regressions**: the eligibility split must preserve
  `resolveRenderOwner` scope routing; the portal harness scenario runs in Phase 6 acceptance.

## Definition of Done

- [ ] All phases complete; checklists ticked; census results and divergence markers recorded.
- [ ] `svelte-check`, unit suites, lint, knip, prettier clean; clippy clean for the census tool.
- [ ] C061 ground pose: particle-attributable CPU ≤ 0.25 ms/frame after Track A (Phases 1–3),
      and scaling with visible particles only after Phase 6; A/B tables in Decisions.
- [ ] Screenshot/metric parity per the Phase 5 standard on all particle scenarios.
- [ ] No new `any`, no swallowed errors, no per-frame allocation on the particle frame path.

## Open Questions

- Default global instance budget: the census gives p50 12 / p90 36 / p99 102 clamped instances
  per eligible emitter; a C061-density scene (~626 resident emitters, far fewer visible) suggests
  a low-five-figure default leaves headroom while still bounding pathology. Pick the number when
  Phase 6's diagnostics can validate it against real visible-emitter sums.
- Sky-target emitters (weather) under Track B: their origins are viewer-relative; likely CPU
  path forever, but confirm with the census how many exist.

## Decisions and Course Corrections

- **Explorer-in-Tauri spot check confirmed (2026-08-19, user):** "looks good in explorer to me"
  at the same pose. Phase 4's last outstanding item is closed; the harness numbers hold in the
  real app.

- **Code-quality pass on the Track A diff (2026-08-19), before commit.** Two self-review findings
  fixed: `LiveParticle`'s doc comment still claimed "spawn constants plus a birth time, and
  nothing else" after gaining `deathTime`, and `getResolvedOrigin` looked its node up twice
  (`#nodes.has` then `#requireNode`) on what is explicitly a hot path — now one `#nodes.get`.
  Deliberately *not* changed: `targetLives` and `sceneOriginOf` are two injected dependencies that
  must stay in agreement, which is mild coupling, but collapsing them would reintroduce the
  per-frame resolve this plan exists to remove; the invariant is named in both doc comments
  instead.

- **Phase 5 divergence drafts (2026-08-19), for ratification with the parity standard.** These are
  the comments Phase 6 would land at the emission site, in the repo's required form (behavior,
  `acclient.c` citation, what breaks if "corrected", census that sized it):

  1. **Emission cadence decoupled from frame rate.**
     `RETAIL DIVERGENCE:` retail treats `birthrate` as a minimum interval and releases at most one
     particle per update with no catch-up (acclient.c:312447-312476, 318289), so authored density is
     frame-rate-coupled: a 5 ms birthrate emits at 60 Hz on a 1999 client and at 376 Hz on ours.
     Closed-form emission releases on the authored schedule instead. Census: 17 of 1,849
     interval-driven emitters author sub-frame (< 16.7 ms) birthrates, so all other emitters are
     unaffected. Note we already diverge here implicitly — the current CPU path emits once per
     *our* frame, which is not retail's rate either; this makes the behavior explicit and
     frame-rate-independent rather than introducing a new departure.

  2. **Population cap clamps the alive window instead of delaying births.**
     `RETAIL DIVERGENCE:` at `max_particles` retail skips the emission and retries next tick, making
     the birth schedule depend on when randomized lifespans happened to end (acclient.c:312447-312476).
     That history-dependence has no closed form, so a capped emitter instead emits on schedule and
     draws only the newest `max_particles` generations. Steady on-screen density is unchanged; what
     differs is turnover — retail's capped particles live full lifespans, ours are retired early.
     Census: 208 of 614 GPU-eligible emitters (34 %) are cap-binding. Accepted deliberately
     (user decision, 2026-08-19) because particle *motion* stays exact and one uniform arithmetic
     model beats a split population.

  3. **Per-field spawn roll ordering not preserved — and, on inspection, NOT a retail divergence**
     (surfaced by the Phases 5–7 dry-run, corrected 2026-08-19 after checking the roll source).
     Draft 3 originally proposed a `RETAIL DIVERGENCE` marker here. That was wrong, and the reason
     matters: we sample retail's *distribution* (`RollDice(-1,1) * variance + base`) but the source
     is `Math.random` in production — retail's own LCG is not implemented anywhere. Retail-identical
     particle values were therefore never achievable and are not claimed. The preserved field order
     buys **our own** determinism (a seeded `roll` reproduces a known sequence, which the unit tests
     assert against) and documents retail's order faithfully; it does not reproduce retail's output.
     Per AGENTS.md — markers are reserved for observable behavior, and our own structural choices
     are not divergences — this is a **test-strategy change, not a compatibility change**, and gets
     no marker. What it does cost is real and belongs in the parity standard: the CPU path's
     stream-of-draws model is why a seeded run is reproducible today, and hashing replaces it.
     The comment citing acclient.c:318125-318158 stays on the CPU path, which still honors the
     order.

- **Phases 5–7 dry-run (2026-08-19) — one finding changes what "parity" can mean, and it needs a
  decision before Phase 6 starts.**

  **Phase 6 is a rework of the particle instance path, not an extension of it.** Today
  `particle-instance-stream.ts` uploads 21 floats of *per-particle* spawn data and
  `webgl2-particle-program.ts` reads them as instance attributes (locations 3–8), evaluating motion
  from constants plus `uClockSeconds`. Closed-form emission deletes the per-particle attributes for
  the eligible population and replaces them with per-*emitter* constants plus `gl_InstanceID` → the
  generation index `k`. So the vertex stage keeps its motion evaluator unchanged but gains a
  generation stage in front of it, and the buffer/upload layer changes shape rather than gaining a
  path. That is the bulk of Phase 6's cost and it is bigger than the phase text implies.

  **The parity finding: CPU-path and GPU-path builds cannot be screenshot-compared, by
  construction.** The plan assumed the open question was *how to pin* hash-driven randomness. It is
  actually more fundamental. The CPU path draws each spawn field from retail's **ordered roll
  sequence** (acclient.c:318125-318158), preserved deliberately so a deterministic source
  reproduces the same per-field sequence rather than merely the same marginal distributions. An
  in-shader hash produces the same *distributions* but different *values* for the same particle. A
  seeded hash therefore buys reproducibility within a build, but no seed makes a GPU-emitted scene
  match a CPU-emitted one pixel for pixel. Screenshot parity across the Phase 6 cutover is not
  achievable at any effort level, so it must be replaced rather than engineered.

  What remains available, and is arguably stronger evidence than a screenshot diff:
  1. **Formula agreement** — feed identical spawn constants to `particle-motion.ts` and the shader
     and compare positions/scale/translucency. This already exists as the shader's checking
     mechanism and is unaffected by how constants are produced.
  2. **Distribution agreement** — assert the in-shader hash reproduces each authored field's
     marginal distribution (range, mean, clamping at the retail bounds) over many generations,
     which is the property content actually depends on.
  3. **Self-determinism** — same build, same seed, same frame → identical image, preserving the
     existing `--particle-seed` workflow for every future change *after* the cutover.
  4. **Structural metrics** — emitter/instance/draw counts and budget accounting across the
     cutover, which must be explainable even though pixels move.

  **Consequence worth naming:** abandoning the per-field roll *ordering* is a third documented
  departure. It is weaker than the other two — content cannot observe correlation between one
  particle's fields, only each field's distribution — but it is a real departure from a property
  the code went out of its way to preserve, so it should be marked and justified rather than
  quietly dropped.

  **Phase 7 is unaffected** by the above; its guarantee census still holds, with the CPU-path
  residue of `collectCohorts` as its main open sizing question.

- **Phase 4 (2026-08-19) — Track A measured; both parked items closed.**

  C061 ground pose, runtime tick means, real GPU (Track A medians of 5; baseline medians of 3 —
  the baseline predates this plan's execution and was not re-run, but the ranges do not overlap,
  so the effect is not a sampling artifact):

  | metric                    | baseline (range)      | Track A (range)       | delta |
  | ------------------------- | --------------------- | --------------------- | ----- |
  | `particleAdvance` mean    | 0.363 (0.317–0.373)   | 0.042 (0.040–0.060)   | −88 % |
  | `particleCohort` mean     | 0.100 (0.097–0.103)   | 0.090 (0.082–0.102)   | −10 % |
  | runtime tick `totalMs`    | 1.620 (1.540–1.683)   | 1.283 (1.228–1.420)   | −21 % |
  | `averageFrameWorkMs`      | 1.659                 | 1.268                 | −24 % |

  Workload is identical across every run: 626 emitters, ~3,700 live particles, ~674 submitted
  instances. This is cost per unit of work, not less work.

  **V8 self time, normalized per frame** — required, not optional: the faster build fits 7,078
  frames into the same 10 s window against the baseline's 5,351, so raw window totals overstate
  the "after" side by a third. `collectCohorts` in particular *looks* 18 % worse raw and is
  actually 11 % better per frame.

  | function                 | before µs/f | after µs/f | delta  |
  | ------------------------ | ----------- | ---------- | ------ |
  | `advance`                | 159.8       | 37.6       | −76 %  |
  | `#sceneOriginOf`         | 84.9        | 0.0        | −100 % |
  | `#resolvePlacement`      | 96.0        | 16.1       | −83 %  |
  | `multiplyMat4`           | 78.0        | 4.6        | −94 %  |
  | `collectCohorts`         | 80.3        | 71.4       | −11 %  |
  | `getResolvedOrigin`      | —           | 10.8       | new    |
  | garbage collector        | 34.2        | 21.6       | −37 %  |
  | **sum of named, ex-GC**  | **552.0**   | **188.2**  | **−66 %** |

  Particle-attributable CPU is now ≈ **0.16 ms/frame** against the ≈ 0.7 ms baseline, clearing the
  Definition of Done's ≤ 0.25 ms target for Track A.

  **Parked item 1 — affine `multiplyMat4` specialization: closed, not doing it.** The structural
  fix took `multiplyMat4` from 78.0 to 4.6 µs/frame, so the entire remaining budget for the
  function is under 5 µs/frame and a 40 %-cheaper compose could win at most ~2 µs. This is the
  plan's own north star holding up: removing calls beat making calls cheaper, and there is now
  nothing left worth specializing. Re-open only if a future dynamics change puts the call volume
  back.

  **Parked item 2 — `collectCohorts` record refill: left to Track B, not fixed interim.** At
  71.4 µs/frame it is now the largest single particle cost, but Track B deletes it structurally
  for the eligible population rather than optimizing it, and an interim per-particle-record
  rewrite would be thrown away by Phase 6. Revisit in Phase 7 for whatever residue the CPU path
  still carries.

  **Outstanding, user-owned:** the explorer-in-Tauri spot check. The harness cannot produce it.
  Expect a larger relative gain there than these V8 numbers show, because the deleted work was
  allocation- and property-access-heavy, which is where JavaScriptCore lags hardest.

- **Phases 1–3 landed (2026-08-19).** Track A is in: `svelte-check` 0 errors, 1,177 unit tests,
  eslint and clippy clean.

  **Phase 1** added `SceneGraph.getResolvedOrigin` — residency plus a landblock-local origin,
  resolved by walking the origin *point* up the parent chain (`getMat4Translation` seeds it from the
  node's own transform, then one `transformPoint3` per hop, aliasing input and output so the
  returned vector is the only allocation). `GameRuntime.#sceneOriginOf` consumes it. The equality
  test deliberately uses a chain with **rotation and non-uniform scale**, because that is what
  separates a correct point walk from naively summing translations; a root-only or
  translation-only fixture would pass either way.

  **Phase 2** split liveness from resolution. `advance` now asks the new `targetLives` dependency
  (runtime-side: sky registry, else `SceneGraph.hasNode`) and resolves nothing; `#emitDue` resolves
  the origin only after the per-meter, population-cap, and interval gates all pass. Since every
  registered target publishes an origin, a null origin *after* a liveness check is a broken
  contract and now throws rather than silently dropping an emitter. Two call-count tests pin the
  contract: zero origin reads across three non-spawning frames, exactly one on a spawning frame.

  **Phase 3** made expiry closed-form. `LiveParticle` carries `deathTime` (stamped
  `birthTime + lifespan` at spawn) and `EmitterInstance` carries a `nextDeathTime` watermark, so a
  frame with nothing due costs one comparison and a frame with something due costs one in-place
  compaction pass with no allocation. Equivalence is exact, not approximate:
  `particleLifeProgress(spawn, t) < 1` reduces to `t < lifespan` for every lifespan the spawn path
  can produce — including the degenerate zero, which stays born-dead — so no special case survives.
  `birthTime` and `deathTime` became mutable together, which also let `#reconcileVisible` shift ages
  in place instead of rebuilding the particle array through `map`.

  **The seam the plan flagged held.** `#reconcileVisible` shifts birth, death, and the watermark by
  the same suspension; the regression test hides an emitter across its entire lifespan and asserts
  the particle both survives reconciliation *and* then dies a full lifespan later, which fails
  loudly if any one of the three shifts is missed.

  **Concession — watermark short-circuit is not directly tested.** The plan's checklist asked for
  call-count verification of the skip. The only way to observe it is reaching into private emitter
  state (a Proxy over `instance.particles`), which is exactly the brittle, internals-coupled test
  the repo's testing guidance rejects; drafted, then deleted. Its correctness is covered
  indirectly — a wrong watermark suppresses a due reap, which the expiry boundary cases catch — and
  its *benefit* is measured by the harness rather than asserted by a unit test.

  **Concession — per-phase A/B attribution for Phase 1 alone was lost.** The Phase 1 measurement
  runs were launched in the background and overlapped the Phase 2 edits, so the third run and the
  profile were contaminated by a partially-applied change. Those logs were discarded rather than
  reported. Track A is measured as a whole against the Phase 0 baseline instead; the discipline
  going forward is to hold edits while a measurement is in flight.

- **Cap-clamp fork resolved: diverge (2026-08-19, user decision):** All 208 cap-binding
  eligible emitters take the clamped closed form on GPU rather than routing to the CPU path.
  Rationale: one uniform arithmetic model beats a split population, and the fidelity priority is
  particle *motion* — which the closed form reproduces exactly — not emission scheduling. The
  observable difference on those emitters is turnover character (retail delays births at cap and
  particles live full lifespans; the clamp emits on schedule and truncates the oldest), with
  steady on-screen density unchanged. Phase 6 still lands the formal `RETAIL DIVERGENCE` marker
  with the acclient.c citation and the 208/614 census sizing; Phase 5's remaining ratification
  items are the (near-free) cadence divergence write-up and the parity-methodology choice.

- **Phase 0 baseline recorded (2026-08-19, medians of 3 runs, real GPU, C061 ground pose):**
  Runtime tick means: `particleAdvance` 0.363 ms (0.317 / 0.373 / 0.363), `particleCohort`
  0.100 ms (0.103 / 0.097 / 0.100); populations stable at 626 emitters / ~3,660 particles /
  ~669 submitted instances in 5 batches every run. Caveat for A/B reads: the `particleAdvance`
  tick mark also covers `#refreshAmbient`, `ambient.advance`, and `audio.advance`
  (game-runtime `render()` marks after all four), which the V8 profile prices at ≈ 0.02 ms
  combined — small, but the mark is not particles alone. The V8-attributed particle total
  (≈ 0.7 ms/frame incl. placement-resolve share, `collectCohorts`, instance encode, routing)
  from the motivating-evidence profile is the primary target number; the tick medians are the
  per-phase tracking metric. Logs: `particles-baseline.cpuprofile` + `baseline-run{1,2,3}.log`
  (job scratch, not checked in).

- **Phase 5 census gathered early (2026-08-19), tool landed as
  `crates/holtburger-debug-harness/src/bin/particle_emitter_census.rs`:** All 2,051
  `ParticleEmitterInfo` records decode cleanly. 202 are per-meter-only (unrecovered predicate,
  never emit today). Of 1,849 interval-driven emitters: 1,111 persistent, 738 finite, 737
  follows-parent; **614 are GPU-eligible-shaped** (persistent, not follows-parent — owner
  staticness remains a runtime fact). Alive-window bounds for the eligible set: p50 12 / p90 36 /
  p99 102 instances, with one degenerate outlier (bound 1,000,001) that the `maxParticles` clamp
  handles. Two divergence sizes came back asymmetric:
  - **Cadence divergence is tiny:** only 17 of 1,849 emitters author sub-frame (< 16.7 ms)
    birthrates, so decoupling emission from frame rate is observable almost nowhere. Note the
    harness already runs uncapped (~376 fps), so today's CPU path already emits faster than
    retail's 60 fps client for every emitter — the divergence exists now, implicitly.
  - **Cap-clamp divergence is not tiny: 208 of the 614 eligible emitters (34 %) have
    `maxParticles` below their alive-window bound.** For those, retail delays births while at
    cap (making the birth schedule lifespan-dependent), where the closed form slides a clamped
    window (same steady density, different turnover). Resolved: diverge (see the
    cap-clamp decision below).

- **`getResolvedOrigin` stays particle-scoped; dynamics call sites censused out
  (2026-08-19, resolved pre-implementation):** The three `dynamic-entity-system.ts` placement
  reads split three ways. `resolvedRootPlacement` is event-rate and needs the full matrix — the
  copying API is correct for it. `getVisibleContributions` is per-frame but the matrix *is* its
  product (`sourceToLandblock` instance transform plus the transparent-center transform), so a
  translation query cannot serve it; its waste is the defensive double-clone, whose fix
  (borrow/resolve-once-per-pose-publication) belongs to the named dynamic-placement follow-up.
  `getRuntimeLights` transforms N light points per parentless root — for N > 1 a single matrix
  resolve beats N chain-walks, so the point query is the right primitive only at N = 1. A
  generalized `transformNodePoint` therefore has zero net consumers beyond the particle origin
  case and is not built (YAGNI).

- **Throttled off-screen advance dropped (2026-08-19, pre-implementation):** Considered as a
  middle ground between retail's off-screen freeze and full per-frame bookkeeping. After
  Phases 2–3 an off-screen emitter's per-frame cost is a liveness check and a watermark
  comparison, and Phase 6 removes the population entirely; throttling would optimize a rounding
  error. The retail-faithful suspension machinery (`#reconcileVisible`) stays for the CPU path.
- **Shared budget replaces the `maxParticles`-census blocker (2026-08-19, pre-implementation):**
  The original GPU-emission sketch required proving authored caps never bind. Accepting
  emitter-granularity truncation under an explicit global budget (user decision) turns the cap
  into an alive-window clamp — one census-sized divergence instead of a correctness
  precondition.
- **Affine `multiplyMat4` specialization parked (2026-08-19, pre-implementation):** Structurally
  removing calls (Phases 1–2) beats making calls cheaper; re-decide at Phase 4 with the
  surviving call volume, which by then is dominated by dynamics part-pose composition outside
  this plan's scope.
