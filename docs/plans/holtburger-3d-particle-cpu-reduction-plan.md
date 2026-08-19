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

- Census, both divergence write-ups, and the parity standard all recorded in Decisions and
  signed off (2026-08-19). Phase 5 is complete; Phase 6 is unblocked.

**Task checklist:**

- [x] Census tool and results in Decisions (gathered early, 2026-08-19)
- [x] Divergence write-ups drafted (approval pending with the parity standard)
- [x] Parity methodology decided

### Phase 6: Persistent particle records (data texture, landblock space, spawn-time writes)

**Replaces the original closed-form GPU emission design** (see Decisions, 2026-08-19). That design
bundled two ideas: *stop rebuilding the particle list every frame* (the structural win) and *have
the GPU derive each particle from its index* (the risk). This phase takes the first without the
second. Emission stays on the CPU exactly as retail specifies it, so **no retail divergences are
needed at all** — the cap-clamp and cadence divergences ratified in Phase 5 go unused, and the
eligibility split disappears with them.

**The shape.** A particle's record is immutable after spawn except for its origin, and even the
origin is fixed for a trailing emitter. So the record is written once, at spawn, into a persistent
slot the GPU reads directly; the per-frame CPU walks *emitters*, never particles.

Three mechanisms make that work, each answering a measured obstacle:

1. **Records live in an RGBA32F data texture**, indexed by `gl_InstanceID + uInstanceBase`, not in
   vertex attributes. Rebinding six attribute pointers costs ~20 GL calls per drawn range; a
   uniform plus a draw costs 2. This is what keeps device-state churn *below* today's ~100
   calls/frame even as the number of ranges rises. Precedent: `webgl2-terrain-program.ts` and
   portal envelope sampling already drive lookups through `texelFetch`.
2. **Origins are stored in landblock space**, with the landblock offset supplied per drawn range as
   a uniform. A camera crossing then changes a uniform, never stored data, so persistent records are
   immune to re-anchoring. This reuses the frame-input plan's North Star 3 rather than inventing a
   convention.
3. **The origin is a sum, not a branch**: `origin = storedOrigin + uEmitterOrigin`. A trailing
   emitter stores its real spawn origin and passes `uEmitterOrigin = 0`; a following emitter stores
   zero and passes its live landblock-space origin. One uniform serves both, with no per-particle
   work for either and no eligibility test anywhere.

**Sub-phases**, each independently verifiable and each leaving the tree working:

**6a — data texture, same lifetimes.** Move the per-particle record from the instance attribute
stream to a data texture read by `texelFetch`, keeping the existing per-frame rebuild. No lifetime
or ownership change; this isolates the texture path so a regression here cannot be confused with
one from persistence. Deliverables: record store with a CPU `Float32Array` mirror and dirty-range
upload, shader reads via `gl_InstanceID + uInstanceBase`, `webgl2-particle-instance-buffer.ts`
retired. Acceptance: DA55 candle pose and C061 render unchanged; GL call count per frame reported
and not worse.

**6b — landblock-space origins.** Stop baking the anchor into records: store landblock-space
origins and add `uLandblockOffset` per drawn range, which forces ranges to be landblock-homogeneous
(free — landblock becomes a sort key). Acceptance: a landblock-crossing flight renders correctly;
`--relocate-sequence` shows no origin drift.

**6c — persistent slots (the win).** Each emitter owns a contiguous slot region sized
`min(maxParticles, aliveWindowBound)`. Spawn writes one record; death compacts by swapping the last
live record into the freed slot. `collectCohorts` and the pooled `ParticleInstanceRecord` path are
deleted outright — the per-frame path becomes: cull emitters, then per visible emitter set uniforms
and draw. Acceptance: no per-particle CPU work in a frame profile; particle populations and draw
structure unchanged at C061.

**6d — following-emitter origin uniform.** Following emitters store zero and carry their live origin
in `uEmitterOrigin`, removing the last per-particle per-frame write. Acceptance: a following-emitter
scene (moving creature) shows zero per-particle frame work; trails still render behind movers.

**6e — budget, diagnostics, and range merging if measured necessary.** Global instance budget with
farthest-first emitter truncation; slot occupancy, dirty-upload bytes, range count, and GL calls in
diagnostics. Range merging across adjacent same-key emitters is deliberately **not** built up front:
start with one range per visible emitter (~72 at C061, ~144 GL calls) and add merging only if the
numbers demand it.

**Acceptance criteria (phase-wide):**

- Parity per the Phase 5 standard: formula agreement (CPU reference vs shader), distribution
  agreement, structural metrics, and visual review at the DA55 candle pose.
- C061 ground pose: zero per-particle CPU work per frame; particle-attributable CPU below the
  ~0.16 ms/frame Track A left; GL calls per frame not worse than today.
- Portal, sky, filtering, and relocation harness scenarios still pass.

**Task checklist:**

- [x] 6a data texture; attribute stream retired
- [x] 6b landblock-space origins, re-anchored by a per-frame uniform
- [x] 6c persistent slots; `collectCohorts` and pooled records deleted
- [ ] 6d following-emitter origin uniform
- [ ] 6e budget, diagnostics, and a measured decision on range merging
- [ ] Harness A/B recorded in Decisions


### Phase 7: Cleanup & guarantee census

- Sweep vocabulary: the `collectCohorts` "measured debt" comment (the mechanism it describes is
  gone), any "cohort" naming that no longer groups anything, dependency doc comments describing
  the old call rates.
- Delete dead paths: the pooled `ParticleInstanceRecord` machinery, `writeParticleInstance`, the
  instance attribute stream, and any diagnostic that now reports a permanent zero.
- Verify every guarantee of the deleted per-frame mechanisms against its named replacement:
  - per-frame origin freshness (advance) → spawn-time resolution + `targetLives`
  - per-frame reap exactness → `deathTime` watermark + compaction
  - per-frame record freshness → spawn-time write + death compaction into persistent slots
  - anchor freshness in records → landblock-space storage + per-range offset uniform
  - following-emitter origin freshness → per-range `uEmitterOrigin`
  - per-frame attribute rebinding → `uInstanceBase` addressing into the data texture
  - unbounded draw volume → global budget with diagnostics

**Task checklist:**

- [ ] Vocabulary and dead code swept
- [ ] Guarantee/replacement census verified and recorded in Decisions

## Risks & Mitigations

- **Slot leakage or aliasing** (a freed slot still drawn, or two particles sharing one): slot
  allocation and death compaction are the only writers; unit tests cover spawn/death/compaction
  ordering, and a slot-occupancy diagnostic makes a leak visible in the existing leak-check flow.
- **Dirty-range upload degenerating to a full-texture upload** (scattered spawns across a large
  store): track dirty rows rather than a single min/max span, and report uploaded bytes per frame
  so a pathological pattern is visible rather than merely slow.
- **Device-state churn eating the saving** (the trap that killed the original Phase 6): the data
  texture keeps a range at 2 GL calls; GL calls per frame is an acceptance metric, not an
  afterthought.
- **Following emitters spending draws** (one range each, no merging): bounded by emitter count
  rather than particle count, but C061 is scenery-heavy and does not exercise it — measure on a
  moving-creature scene before concluding.
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

- [x] Phases 1–5 complete; checklists ticked; census recorded.
- [ ] Phase 6 sub-phases complete; Phase 7 cleanup and guarantee census recorded.
- [ ] `svelte-check`, unit suites, lint, knip, prettier clean; clippy clean for the census tool.
- [x] C061 ground pose: particle-attributable CPU ≤ 0.25 ms/frame after Track A — **met at
      ~0.16 ms/frame** (Phase 4 table).
- [ ] After Phase 6: no per-particle CPU work per frame; GL calls per frame not worse than today.
- [ ] Parity per the Phase 5 standard on all particle scenarios.
- [ ] No new `any`, no swallowed errors, no per-frame allocation on the particle frame path.

## Open Questions

- Default global instance budget: the census gives p50 12 / p90 36 / p99 102 alive-window
  instances per emitter; at C061, 72 visible emitters carry 669 instances. Pick the number in 6e
  when diagnostics can validate it against real visible sums.
- Slot region sizing: `min(maxParticles, aliveWindowBound)` is the intended bound, but the census
  showed `maxParticles` below the alive window for 208 of 614 emitters, so the min is load-bearing
  rather than belt-and-braces. Confirm total store size at C061 before fixing the texture
  dimensions.
- Sky-target emitters (weather) have viewer-relative origins, so "landblock space" needs a defined
  meaning for them — most likely they keep a per-range origin uniform like following emitters.
  Resolve in 6b.

## Decisions and Course Corrections

- **6c landed (2026-08-19) — the mechanism works; the draw count now caps the payoff.**

  Records are written once at spawn into per-emitter slot regions and read by the GPU every frame
  after. `collectCohorts` and the pooled `ParticleInstanceRecord` machinery are deleted; the frame
  path walks visible emitters only.

  **Region sizing turned out simpler than the plan assumed.** The plan specified
  `min(maxParticles, aliveWindowBound)`, treating the alive-window estimate as load-bearing. It is
  not needed: a census of `max_particles` (added to the census tool) came back at p50 15, p99 100,
  **max 240**, summing to 39,205 slots for the entire authored corpus — about 15 MB if every
  emitter in the game were resident at once. So regions are simply `maxParticles`, which the
  emission path already enforces, making overflow impossible by construction with no estimate to
  get wrong and no clamp divergence.

  **Evidence, C061 medians of 3 against Track A:**

  | metric | Track A | 6c | note |
  | ------ | ------- | -- | ---- |
  | range collection (was cohort) | 0.090 | **0.027** | −70 % |
  | `particleAdvance` | 0.042 | 0.040 | unchanged |
  | average frame work | 1.268 | **1.229** | −39 µs/frame |
  | submitted instances | 670 | 672 | identical workload |
  | draws | 5 | **72** | one range per visible emitter |

  **The honest read: the per-particle walk cost 63 µs and its removal returned 39 µs**, because
  going from 5 draws to 72 gave about 24 µs back. That is the tradeoff the design accepted, and it
  is now the limiting factor rather than a footnote.

  **Consequence for the remaining sub-phases, which the numbers reorder:**
  - **6e's range merging is now the highest-value item, not the cleanup item** — it targets the
    24 µs directly. But merging as the plan described it (adjacent same-key ranges) will rarely
    fire: a merged draw must cover the slots between two regions, and a region is only full when
    its emitter is at its cap. Making merging actually work needs regions *allocated* grouped by
    mesh and motion law, plus a dead-slot sentinel the vertex stage skips, so a merged draw can
    span partially-filled regions. That is a real piece of work, not a tidy-up.
  - **6d's value is now scene-dependent and its cost is per-draw.** Moving a following emitter's
    origin into a uniform removes its per-frame record writes, but costs two `uniform3f` per drawn
    range for *every* emitter, follower or not. C061 is scenery-heavy with few followers, so it
    would measure as a small loss there and a win in combat-like scenes. It needs a
    moving-creature scene to evaluate honestly, which no current harness pose provides.

- **6a and 6b landed (2026-08-19).**

  **6a — data texture.** Spawn constants moved from six instance attributes to an RGBA32F texture
  read by `texelFetch`, indexed by `gl_InstanceID + uInstanceBase`. Lifetimes deliberately
  unchanged, so this isolates the texture path from the persistence change to come. Measured
  neutral at C061 (`particleAdvance` 0.042 → 0.043, `particleCohort` 0.090 → 0.086, tick 1.283 →
  1.304, identical 5 batches / ~670 instances), which is the expected result for plumbing: it
  removed ~100 attribute-binding GL calls per frame and added one texture upload.
  `WebGL2ParticleInstanceBuffer` retired; the replacement store keeps its invariants and adds one
  the attribute path never needed — each record starts on its own texel stride.

  **6b — landblock-space origins, with a better mechanism than the plan specified.** The plan
  called for a per-*range* landblock offset uniform, which would have forced ranges to be
  landblock-homogeneous and split batches. Storing the origin **split** instead — a landblock
  scene origin plus a landblock-local offset — allows a single per-*frame* anchor uniform and no
  batch splitting at all. It is also strictly more precise: one scene-space origin near 40,000
  units differenced against a similar-magnitude anchor in float32 loses ~5 mm to cancellation on
  every particle, whereas landblock origins and the anchor are both exact multiples of the
  landblock size, so their difference is exact and the small local part keeps full precision.

  **The three floats were free.** 6a padded records to whole texels with three spare lanes; the
  split needs exactly three. The record grew 21 → 24 floats inside the same six texels.

  **Addition through subtraction:** `ParticleSystem` no longer takes a `renderAnchorOrigin`
  dependency — anchoring belongs to the renderer's frame — and `GameRuntime.#renderAnchorOrigin`
  went with it. A `LandblockVector3` tuple brand now makes the stored frame compiler-checked
  rather than commented.

  **Test replaced, not adapted.** "Keeps left-behind particles in place when the render anchor
  moves" asserted anchor-relative behaviour that no longer exists; it now pins the real invariant
  (coarse part on the landblock grid, the two parts reconstructing the scene origin exactly, local
  part inside one landblock).

  **Verified:** DA55 candle pose pixel-identical across 6a and 6b; a three-hop relocation flight
  renders correctly with particles intact and no origin drift.

- **Phase 6 redesigned and approved (2026-08-19, user): persistent records, not closed-form
  emission.** The original phase bundled "stop rebuilding the particle list every frame" with
  "have the GPU derive each particle from its index." Nearly all the CPU saving came from the
  first; nearly all the risk and every divergence came from the second. They separate cleanly, so
  the phase now takes only the first.

  **Consequences, all simplifying:**
  - **No retail divergences.** Emission stays on the CPU on retail's schedule with retail's cap
    behavior, so the cap-clamp and cadence divergences ratified in Phase 5 are not needed. They
    remain recorded as approved-but-unused in case closed-form emission is ever revisited.
  - **No eligibility split.** The original design could not serve moving owners at all, because
    spawn-frame rotation and frozen origins are history-dependent snapshots that an index cannot
    reproduce. Persistent records *store* those snapshots, so history stops being a problem: 1,112
    trailing emitters get fully static records (moving owner or not — a trail streaming off a
    running creature is the same case as a campfire), and 737 following emitters carry one live
    origin per emitter rather than per particle. The population axis that matters turned out to be
    `followsParent`, not owner staticness.
  - **No in-shader spawn logic**, so the RETAIL QUIRK semantics in `#emit` and `particle-motion.ts`
    stay where they are and the parity exposure shrinks to "does the shader read the same numbers
    it used to read."

  **Three mechanisms, each answering a measured obstacle rather than a guess:** an RGBA32F data
  texture indexed by `gl_InstanceID + uInstanceBase` (2 GL calls per drawn range instead of ~20,
  keeping churn below today's ~100 calls/frame); landblock-space origins with a per-range offset
  uniform (crossing immunity, reusing the frame-input plan's North Star 3); and
  `origin = storedOrigin + uEmitterOrigin`, which serves trailing and following emitters with one
  uniform, no branch, and no eligibility test.

  **Sequenced as 6a–6e** so each step is independently verifiable: data texture first with
  lifetimes unchanged (isolating the texture path from the persistence change), then landblock-space
  origins, then persistent slots, then the following-emitter uniform, then budget and diagnostics.
  Range merging is deliberately deferred to 6e and gated on measurement — one range per visible
  emitter is ~144 GL calls at C061, already below today's ~100-call baseline plus the attribute
  binding it replaces.

- **Correction (2026-08-19): `baseInstance` is NOT the blocker — I overstated it.** The renderer
  already draws arbitrary instance sub-ranges: `WebGL2ParticleInstanceBuffer.bindAttributes(
  firstInstance)` rebinds all six instance attribute pointers at a byte offset, and the pass calls
  it once per batch today. So subset drawing is expressible in core WebGL2 with no extension. The
  real constraint is **cost per range**, not possibility.

  **Quantified device-state churn.** Each range costs 1 `bindBuffer` + 6 x (`enableVertexAttribArray`
  + `vertexAttribPointer` + `vertexAttribDivisor`) + 1 `bindBuffer` = ~20 GL calls. Today's 5
  batches spend ~100 calls/frame. Scaling that to ranges:

  | ranges per frame | GL calls | verdict at ~0.3-1 us per call |
  | ---------------- | -------- | ----------------------------- |
  | 5 (today)        | ~100     | baseline |
  | ~20 (merged runs)| ~400     | +90-300 us/frame — eats much of the saving |
  | 72 (per emitter) | ~1,440   | far exceeds the saving |

  **The fix that makes every variant viable: move per-particle records out of vertex attributes and
  into a data texture**, indexed by `gl_InstanceID + uInstanceBase`. A range then costs 1 uniform +
  1 draw = **2 GL calls**, so ~20 runs spend ~40 calls — *fewer than the ~100 we spend today*.
  Precedent is established in this renderer: `webgl2-terrain-program.ts` drives composition, light
  mask, and surface-field lookups through `texelFetch`, and portal envelope sampling does the same.
  Cost is ~6 extra texel fetches per vertex, negligible at these particle counts.

- **Landblock-crossing immunity: solved, and by the pattern this codebase already ratified.** Store
  particle origins in **landblock space** and pass the landblock offset as a per-run uniform. A
  crossing then changes a uniform value, never stored data, so persistent records survive it
  untouched. This is exactly North Star 3 of the frame-input compilation plan — "anchor-relativity
  is a per-landblock frame fact, never a cached fact; cached spatial facts live in landblock
  space" — reused rather than reinvented. It requires runs to be landblock-homogeneous, which
  costs nothing because the buffer is being sorted for locality anyway; landblock simply becomes a
  sort key ahead of spatial order. Following emitters' live per-emitter origin uniform becomes
  landblock-relative on the same basis.

  Rejected alternative: storing world-space origins and subtracting the anchor in-shader. float32
  at this world's coordinate magnitudes (~40,000 units) resolves to ~4 mm, and the codebase
  deliberately refuses to retain world/render-space positions for exactly this class of reason.
  Rewriting live particles on each crossing was the earlier fallback and is now unnecessary.

- **Phase 6 blocked on a design gap found at implementation start (2026-08-19) — needs a
  decision before any code is written.**

  **The gap.** Phase 6's per-frame contract reads "cull to visible emitters, sort farthest-last,
  prefix-sum bounds, cut at the global budget, draw" — i.e. draw a *subset* of a static
  per-emitter instance buffer with no per-particle CPU work. That requires addressing an arbitrary
  instance range, which in WebGL2 means `baseInstance`. Core WebGL2's `drawElementsInstanced` has
  none (it is the `WEBGL_draw_instanced_base_vertex_base_instance` extension, unused anywhere in
  this renderer), so the subset must be expressed some other way. Every option costs something the
  plan did not budget:

  | option | draws at C061 | per-frame CPU per particle | note |
  | ------ | ------------- | -------------------------- | ---- |
  | one draw per visible emitter (`gl_InstanceID` = k, emitter constants per draw) | **72** (from 5) | none | 14x the draw calls, plus per-draw uniform/UBO-index setup |
  | per-frame `(emitterIndex, k)` instance stream, draws stay coalesced | 5 | 2 floats | keeps coalescing; reintroduces per-visible-particle CPU work |
  | static buffer covering all *resident* emitters, cull in-shader | 5 | none | draws ~7.5k instances instead of 669 — 11x vertex work |

  **Measured at the reference pose** (temporary probe in `collectCohorts`, since removed): 626
  resident emitters, **72 visible**, 69 cohorts, recoalesced to 5 draw batches, 669 submitted
  instances. So per-emitter draws are 72, not the handful the plan implicitly assumed.

  **The prize has also shrunk, because Track A already took most of it.** Remaining
  particle-attributable CPU is ~0.16 ms/frame total: `collectCohorts` 71.4 µs, `advance` 37.6 µs,
  `writeParticleInstance` 23.4 µs, `route` 11.3 µs. Phase 6's realistic ceiling is ~0.08–0.10
  ms/frame saved (option 2 keeps some per-particle work; option 1 risks spending the saving on
  driver overhead). Against that: in-shader reproduction of the entire spawn path (sampling and
  clamps, offset disc projection with its degenerate fallback, spawn-frame rotation, Explode's
  direction roll and minimum-length check, Implode's derived `c`) with every `RETAIL QUIRK`
  preserved, a per-emitter constants table with creation/eviction lifetime, the eligibility split,
  the budget, and the whole new parity apparatus — in the subsystem the repo says is verified by
  looking rather than diffing.

  **Cheaper alternative that captures much of the same win.** The plan parked "per-particle spawn
  record pooling" as out of scope *because GPU emission would supersede it*. If Phase 6 does not
  happen, that reasoning inverts and it becomes the obvious next move: a particle's instance record
  is immutable after spawn except for `origin`, so the record can be built once at spawn and
  `collectCohorts` reduced to writing 3 floats instead of refilling 14 fields. For frozen-origin
  particles — the majority of static scenery — even the origin is fixed in scene space, changing
  only when the render anchor moves (a landblock crossing), so those records can be fully static
  between crossings. Estimated saving 50–60 µs/frame for a contained, low-risk change with no
  shader work, no divergences, and no parity-standard exposure.

  **Also worth weighing:** particles are no longer the largest renderer-owned CPU cost. The same
  profile puts run formation and culling well above them — `formAdjacentObjectInstanceRuns`
  613 ms/10 s, `createObjectSubmissionPhases` 593, `formGroupedObjectInstanceRuns` 534,
  `#frustumIntersectsLandblockBounds` 512 — which is exactly what the frame-input plan predicted
  would surface next.

  **Status: Phase 6 not started.** No code written; the temporary probe was reverted and the tree
  is clean at the two Track A commits.

- **Phase 5 ratified (2026-08-19, user sign-off) — parity standard set and RNG approach chosen.**

  **Order-independent particle RNG is approved**, and on its own merits rather than as a
  concession: "I'm okay with not matching retail's randomness faithfully. I don't think anyone
  will notice. If order-independent RNG is a cleaner fit for our arch then we should do it." This
  is also forced by the closed-form model — the CPU path is a *stream* whose particle `k` depends
  on how many draws every prior particle consumed (and that count is data-dependent: Explode burns
  two extra rolls, the offset path can short-circuit). A stream cannot be indexed; generation-
  indexed emission requires random *access*, i.e. `hash(seed, k, field)`.

  **Scope of the relaxation, stated explicitly by the user: particle RNG only, because particles
  are purely presentation.** It does not generalize to RNG that world state depends on.

  **The parity standard for the Phase 6 cutover**, replacing cross-cutover screenshot parity
  (which is impossible by construction — a hash matches distributions, not values):
  1. **Formula agreement** — identical spawn constants into `particle-motion.ts` and the shader
     produce identical positions, scale, and translucency. Unaffected by how constants are made.
  2. **Distribution agreement** — the in-shader hash reproduces each authored field's range, mean,
     and retail clamping over many generations. This is the property content can actually observe.
  3. **Structural metrics** — emitter, instance, and draw counts plus budget accounting must be
     explainable across the cutover even though pixels move.
  4. **Visual review** — per AGENTS.md, particles are verified by looking; the DA55 candle pose is
     the close-up standard.

  **Dropped from the standard: self-determinism assertions.** The user's steer — "tests asserting
  determinism on the particle RNG are going too far" — removes the leg I had proposed. A seeded
  particle run reproducing an exact image is not a property worth defending for presentation-only
  randomness.

  **Test posture changed to match, ahead of Phase 6.** The one test that asserted a positional roll
  sequence ("samples and clamps every appearance endpoint with its own retail-ordered roll") now
  runs at constant rolls of 0 and 1, asserting each field's formula and both clamp directions
  without any coupling to draw order — better coverage of what matters (both clamps, previously
  only one) and it survives the hash migration untouched. The `rollSequence` helper that existed
  solely to pin draw order is deleted.

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
