# Holtburger 3D Bounded Hybrid Outdoor Shadows Plan

Status: **Implementation complete through Phase 8 on 2026-09-01. Manual defaults are N=32/M=8;
the remaining broader Phase 7 visual matrix is deferred.**

## Context and Boundaries

### Goal

Bound outdoor entity-shadow cost per rendered view while preserving detailed nearby directional
shadows and degrading lower-priority casters to a cheap sun-aligned analytic shadow.

### In Scope

- Replace the fixed-depth PSSM caster search reach with one bounded projection policy derived from
  the effective shadow-sun direction and caster-height/cast-length caps.
- Select at most N eligible outdoor caster roots per rendered view and assign at most M of those
  roots to PSSM, with `0 <= M <= N` enforced by the settings contract.
- Render the remaining selected roots through a terrain-only analytic directional-shadow path.
- Derive PSSM and analytic membership from one deterministic per-view tier decision.
- Make two cascades the complete production and shader maximum.
- Skip target allocation, cascade clears, caster submission, and receiver sampling when a view has
  no mapped casters.
- Preserve the existing indoor analytic-grounding behavior and visibility-island policy.
- Extend opt-in diagnostics and the browser harness sufficiently to tune N/M and prove the bound.
- Sweep superseded outdoor-grounding and three/four-cascade vocabulary from code, tests, controls,
  diagnostics, and durable lighting documentation as part of the cutover.

### Out of Scope

- Static-object shadow casting, indoor shadow maps, terrain self-shadowing, or portal-aware light
  transport.
- A global budget shared across multiple rendered views. Each view owns an independent N/M budget
  so one portal or camera view cannot starve another.
- Exact occluder completeness. Bounded off-screen omissions and resulting edge pop-in are accepted.
- Temporal hysteresis, fade transitions between tiers, or persistent caster assignment unless
  deterministic popping proves unacceptable during final review.
- Triangle-weighted, draw-weighted, or adaptive GPU-time scheduling in the first implementation.
  Root count is the chosen simple proxy; retained metrics decide whether that proxy is honest for
  the actual population.
- Automatic quality scaling or choosing the final N/M values without user review.
- Changes to `holtburger-world`, `holtburger-core`, or other shared crates. This is frontend-owned
  renderer quality and scheduling policy.

## Ground Truth

### Reference Sources

- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - per-view render ordering, expansion cache, animation-liveness union, ordinary contribution
    resolution, terrain receiver selection, and shadow-mode scheduling;
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-outdoor-pssm-pass.ts`
  - current cascade construction, target lifetime, clears, instance uploads, and depth submission;
- `apps/holtburger-3d/src/lib/game/renderer/outdoor-pssm.ts`
  - practical splits, effective sun elevation, stable light fits, fixed caster-search padding, and
    light-frustum extraction;
- `apps/holtburger-3d/src/lib/game/renderer/outdoor-pssm-casters.ts`
  - all-cascade root union, one-expansion-per-root behavior, cascade membership, and compatible run
    formation;
- `apps/holtburger-3d/src/lib/game/renderer/entity-grounding.ts`
  - rigid-pose caster facts, receiver-local intersection, deterministic overflow ranking, and
    fixed-capacity GPU records;
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-entity-grounding.ts`
  - current radial receiver evaluator and strongest-overlap behavior;
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-terrain-program.ts`
  - mutually exclusive PSSM/grounding terrain variants and separation of ambient from regional-sun
    diffuse;
- `apps/holtburger-3d/src/lib/game/renderer/entity-shadow-policy.ts`,
  `apps/holtburger-3d/src/lib/frontend-tuning-contract.ts`, and
  `apps/holtburger-3d/src/lib/frontend-tuning.ts`
  - validated runtime policy, build-time receiver capacity, and current three-cascade defaults;
- `docs/plans/holtburger-3d-pssm-shadow-mapping-plan.md`
  - historical receiver/caster decisions and completed implementation record;
- `docs/plans/holtburger-3d-client-entity-shadow-performance-investigation.md`
  - measured entity-heavy workload, causal mode controls, and already-landed PSSM structural work.

ACE and the retail client decompile are not ground truth for this quality policy. They remain
relevant only if implementation work encounters an authoritative entity category, placement, or
lighting fact whose meaning is unclear. No retail compatibility marker is expected for an
unobservable frontend performance policy; any intentional visible retail departure discovered
during implementation must follow the repository marker convention.

### Existing Evidence

- The reproduced client scene contained 44 visible entity roots and 2,684 visible rigid parts,
  approximately 61 parts per root. Root count is therefore a much smaller selection domain, but it
  is not itself an exact depth-work measure.
- Disabling PSSM while retaining analytic grounding changed the same entity-heavy scene from about
  29 FPS to about 55-57 FPS. Outdoor PSSM is a proven causal performance boundary there.
- The landed selector already unions roots across cascades and expands each unique root once, but
  every retained rigid part is still copied into every intersecting cascade batch.
- Outdoor PSSM currently uses three 2048-square depth24 layers: 48 MiB of depth storage before
  framebuffer metadata. Two layers require 32 MiB.
- The current caster query already uses the exact light frustum built from each camera slice and a
  fixed 64-unit extension toward the sun. A second expanded-camera-frustum query would duplicate
  policy; the existing light volume is the correct mechanism to bound.
- The current outdoor analytic path is a circular terrain grounding term, limited to eight casters
  per receiver and enabled only in `simple` mode. `shadow-maps` enables analytic grounding indoors
  but not outdoors.
- Two local hardware-GPU sanity captures selected zero eligible PSSM roots. Their timings are not
  representative of the reported crowd problem, but they prove the current empty-caster path still
  retains a three-layer target and schedules the PSSM receiver family.
- A deterministic fallback workload now reproduces the measured population as 112 roots with 61
  rigid parts per root. It deliberately shares one geometry and depth state, so it is valid for
  selection, record, upload, and CPU scaling but not for the live population's geometry/run mix.
- The pre-cut fallback workload selected all 112 roots into each of three cascades: 20,496 part
  records, three compatible runs, and 1,639,680 upload bytes per frame. Across three paired samples,
  PSSM CPU ranged from 2.225 to 2.353 ms and PSSM GPU from 0.0769 to 0.0790 ms on an RX 7900 XT.
- The corresponding two-cascade workload selects 13,664 part records, two compatible runs, and
  1,093,120 upload bytes. A post-cut sample measured 1.788 ms mean PSSM CPU and 0.0486 ms mean PSSM
  GPU. This establishes the structural reduction; final performance acceptance remains Phase 7's
  five-repeat representative comparison.

## North Stars

1. Shadow quality must degrade predictably; workload must not grow without a declared bound.
2. One owner computes caster eligibility, ranking, tier, and resolved sun projection. Consumers do
   not independently re-derive those decisions.
3. Spend detailed geometry work on the roots most likely to matter in the current view, then retain
   a coherent directional cue for the rest of the selected population.
4. Prefer an honest fixed root budget over an adaptive scheduler until measurements prove root
   count is an inadequate proxy for the real content distribution.
5. Preserve one root expansion per view across shadow and ordinary rendering. The new policy must
   delete repeated decisions, not add another contribution walk.
6. Outdoor directional analytic shadows and indoor grounding may share immutable caster-shape
   facts, but they must not share misleading semantics or appearance settings.
7. Empty and sparse scenes should pay for the work they contain, not for the maximum configured
   shadow feature.
8. Keep the implementation app-local, stateless where practical, and directly testable without a
   browser; reserve WebGL tests for shader/resource integration.
9. Accept bounded pop-in before adding temporal state. If final review rejects the picture, add the
   narrowest proven transition mechanism.
10. Keep net new production code below approximately 700 lines. Crossing that line requires a
    design resteer and an explicit account of which complexity the feature genuinely needs.

## Target Design

### Policy Shape

Reshape the settings around their actual consumers instead of appending unrelated scalar fields to
the current PSSM object. The exact names may be refined during implementation, but the contract must
express these composites:

```ts
interface OutdoorShadowCasterBudget {
  /** Maximum eligible caster roots retained by one rendered view (N). */
  readonly maximumSelectedRoots: number;
  /** Prefix of the selected roots admitted to PSSM (M). */
  readonly maximumMappedRoots: number;
}

interface OutdoorShadowProjectionSettings {
  /** Maximum caster height allowed to extend either shadow mechanism. */
  readonly maximumCasterHeight: number;
  /** Maximum horizontal sun projection admitted by culling and analytic shadows. */
  readonly maximumCastLength: number;
}
```

- Store the two budget fields together and validate positive/integer bounds plus
  `maximumMappedRoots <= maximumSelectedRoots` in one constructor.
- Derive analytic capacity as `N - M`; do not store a third interdependent count.
- Keep PSSM raster/receiver settings together.
- Give outdoor analytic directional shadows their own strength, softness, radius, and vertical
  receiver-range settings.
- Rename the existing shared `grounding` settings to indoor grounding once outdoor simple mode no
  longer consumes them.
- Choose a conservative validation ceiling from the reproduced resident population and stress
  harness during Phase 1. The ceiling is a safety invariant, not the tuned default.
- Keep N and M runtime-adjustable through the Explorer and `--entity-shadows` harness contract so
  the user can tune them without rebuilding.

### Resolved Outdoor Projection

Compute one immutable per-view projection from the authored sun vector and outdoor projection
policy:

- preserve authored horizontal azimuth;
- apply the existing minimum shadow elevation once;
- expose the normalized direction toward the effective shadow sun;
- derive the maximum along-ray caster reach from both height and horizontal cast caps;
- expose the horizontal cast direction away from the sun;
- provide a per-caster projected length from capped rigid height;
- handle vertical and near-horizontal limits without division-by-zero fallbacks.

PSSM cascade construction consumes the resolved direction and maximum reach directly. Analytic
shadow proxy construction consumes the same resolved projection. Neither consumer clamps or
normalizes the sun again.

### Per-View Candidate and Tier Selection

For each rendered view:

1. Build two stable cascade receiver slices and their bounded light-frustum query volumes.
2. Query both volumes and union their root/cascade membership before any reusable scene-query
   storage is overwritten.
3. Reject non-dynamic, non-caster, hidden, non-outdoor, or invalid-footprint roots before ranking
   wherever the existing contracts allow.
4. Resolve each candidate's rigid world bounds, contact anchor, radius, capped height, stable
   identity, camera-frustum membership, and squared distance to the nearest point of its bounds
   exactly once.
5. Rank camera-frustum-intersecting roots before off-screen roots; rank within each group by nearest
   bounds distance and then stable identity. This spends the accepted off-screen allowance only
   after in-frame casters.
6. Retain at most N roots. Assign the first M to `mapped`; assign the remainder to `analytic`.
7. Expand only mapped roots into material-free depth parts and distribute those parts to their
   intersected cascade batches.
8. Convert analytic roots directly into sun-projected proxies without expanding their rigid draw
   parts.
9. Union both retained tiers into the existing selected-dynamic liveness set so an off-screen
   retained shadow cannot freeze.
10. Publish one frame-owned result containing mapped batches, analytic proxies, rejected counts,
    and selected-root identities. Ordinary scene resolution consumes this result and never ranks or
    reclassifies outdoor shadow roots.

The first implementation budgets complete roots, not parts. Never truncate an expanded actor
halfway through its rigid parts. If metrics show that N/M does not bound selected parts, triangles,
runs, upload bytes, or shadow CPU time in the real workload, stop at the Phase 4 resteer before
adding a weighted budget.

### Empty Mapped Tier

If the mapped tier produces no depth parts:

- return no active PSSM receiver frame;
- do not allocate a first target generation;
- do not attach or clear cascade layers;
- do not compile or bind the caster program;
- do not select PSSM terrain/Building receiver variants;
- continue rendering the analytic tier if it is nonempty.

If a target generation already exists from an earlier nonempty view, retain it across transient
empty frames to avoid allocation churn, but do not clear or sample it. Existing mode changes away
from `shadow-maps` continue to destroy the target generation.

### Outdoor Analytic Directional Shadow

Replace simple-mode outdoor radial grounding with a terrain-only directional analytic shadow and
reuse that same mechanism for the N-M hybrid fallback:

- retain the producer-owned rigid contact anchor and horizontal radius;
- add rigid caster height as a named, consumed fact;
- project a capped line segment away from the effective sun, with length derived from caster height
  and elevation;
- evaluate a soft capsule or equivalent bounded signed-distance shape around that segment;
- keep a bounded vertical receiver interval so stacked or distant surfaces do not receive it;
- compute conservative CPU influence bounds around the complete projected capsule so adjacent
  landblocks receive the same caster;
- retain the existing fixed per-terrain-receiver capacity of eight and deterministic overflow
  behavior;
- combine overlapping analytic casters by strongest occlusion, never addition or multiplication.

Both outdoor mechanisms produce regional-sun visibility. The terrain hybrid receiver combines them
with `min(mappedVisibility, analyticVisibility)` and attenuates regional-sun diffuse once. Ambient,
dynamic lights, static lights, detail, fog, and color grading remain outside that combination.
Because mapped and analytic root sets are disjoint, one actor cannot double-shadow itself.

Indoor EnvCell shells keep the existing short radial grounding evaluator, settings, visibility
islands, strongest-overlap rule, and post-lighting stylization. Buildings continue to receive PSSM
only; analytic fallback remains terrain-only. Far terrain remains shadow-free.

## Phased Implementation

### Phase 1: Freeze the Workload and Cut to Two Cascades

#### Deliverables

- Record a fresh pre-change capture of the user-observed client population or an agreed equivalent
  reproduction, including camera, viewport, render scale, scene counts, roots, parts, runs, upload
  bytes, shadow CPU/GPU time, and effective settings.
- Extend the existing synthetic entity-population harness only if the live reproduction cannot be
  repeated reliably.
- Change the production and compiled PSSM maximum from four to two and the default from three to
  two.
- Remove three/four-cascade UI ranges, fixtures, array expectations, and stale diagnostics
  vocabulary; preserve the generic one/two-cascade code only where it remains simpler.
- Record target bytes and visual captures for the two-cascade result before proceeding.

#### Acceptance Criteria

- The representative workload is reproducible and reports nonzero mapped roots and parts.
- No timing conclusion relies on the earlier zero-caster sanity captures.
- Runtime validation rejects cascade counts above two.
- Receiver/caster shaders, target allocation, Explorer controls, and harness reconfiguration expose
  no three/four-cascade path.
- Two cascades render without seams, missing terminal coverage, shader errors, or resource leaks.

#### Task Checklist

- [x] Capture the representative pre-change workload.
- [x] Cut settings, shaders, targets, tests, controls, and fixtures to at most two cascades.
- [x] Verify one- and two-cascade construction and receiver transitions.
- [x] Capture the post-cut workload and visual result.

#### Decisions and Course Corrections

- The available local weenie catalog is format v8 while the current reader requires v9, and no
  configured live-client account or catalog database was available. The deterministic 112x61
  harness workload is therefore the repeatable baseline; the prior live scene remains the source
  for its root/part distribution and 394-run geometry mix.
- Fixed a harness lifecycle defect discovered during measurement: synthetic entities were retired
  before policy cycles and profiling. They now remain resident through measurement and retire
  before teardown evidence.
- The hard maximum is two cascades, not merely a two-cascade default. Runtime settings and target
  allocation reject higher counts, shaders compile two slots, and Explorer controls expose one or
  two.
- Real-GPU capture `/tmp/holtburger-shadow-two-cascade.png` proves nonzero two-layer submission and
  target lifecycle. Its repeated coplanar fixture geometry is diagnostic rather than suitable for
  visual-quality approval; later visual review uses representative production geometry.

### Phase 2: Resolve Bounded Outdoor Projection Once

#### Deliverables

- Add the validated projection composite and pure resolved-projection function.
- Replace fixed `casterSearchPadding` with the resolved maximum along-ray reach derived from capped
  caster height, maximum cast length, and effective elevation.
- Change cascade construction to consume the resolved projection rather than raw sun plus an
  independently applied clamp.
- Add pure tests for vertical sun, minimum-elevation clamping, low-angle cast-length capping,
  finite outputs, azimuth preservation, and monotonic bounds.
- Add a caster-height/rigid-bounds census to the representative workload before choosing projection
  defaults. Record the distribution beside the chosen values; do not turn the census into standing
  production diagnostics unless it has an ongoing consumer.

#### Acceptance Criteria

- Effective sun direction and query reach are computed exactly once per view.
- The two cascade query volumes contain their receiver slices plus the declared bounded caster
  reach.
- Increasing either projection cap cannot shrink the query volume.
- No fixed padding field, UI label, test fixture, or documentation remains.
- Defaults are backed by the measured rigid-height distribution and visual review.

#### Task Checklist

- [x] Introduce the projection settings and resolved composite.
- [x] Census caster heights in the available representative fallback workload.
- [x] Cut cascade construction over to the resolved projection.
- [x] Delete fixed caster-padding policy and vocabulary.
- [x] Verify bounded query volumes at representative sun angles.

#### Decisions and Course Corrections

- The projection contract now owns minimum effective elevation, maximum caster height, and maximum
  horizontal cast length. It resolves a normalized sun direction, horizontal cast direction,
  maximum along-ray query reach, and maximum projected length once per view.
- The deterministic 112x61 workload has a 2-unit rigid height by construction. The unavailable
  live catalog prevents an honest creature-height distribution census in this worktree, so the
  provisional 16-unit height cap is an explicit 8x safety margin rather than a claimed percentile.
  Phase 7 must validate it in the user's live crowd before it becomes an accepted shipped value.
- Maximum cast length remains 64 units, preserving the prior off-screen reach ceiling while the
  height cap usually supplies the tighter bound at the 33-degree minimum elevation.
- Pure tests cover zero/vertical/low-angle behavior, independent height and horizontal caps,
  azimuth preservation, finite results, and monotonic reach as either cap increases.

### Phase 3: Add One Bounded Caster-Tier Planner

#### Deliverables

- Refactor `outdoor-pssm-casters.ts` into an honestly named outdoor-shadow selection owner, leaving
  PSSM-specific batch/run formation colocated or in a narrow sibling module.
- Add documented candidate, resolved shape, tier, plan, scratch, and metrics types.
- Implement deterministic camera-membership/bounds-distance/identity ranking with overflow-only
  work when candidates do not exceed N.
- Produce mapped PSSM batches and analytic proxies from one selected prefix.
- Preserve one dynamic expansion for each mapped root and zero rigid-part expansion for
  analytic-only roots.
- Publish the selected tier identities for ordinary rendering and animation liveness.
- Implement the empty-mapped-tier early return before target allocation and cascade clears.

#### Acceptance Criteria

- At most N complete roots survive selection and at most M complete roots enter PSSM for every
  view, including cascade-overlap and portal-view fixtures.
- `M > N`, negative, fractional, non-finite, and structural-ceiling violations each fail with one
  precise validation message.
- Camera-intersecting roots rank before off-screen roots; bounds distance and stable identity make
  all remaining ordering deterministic.
- One root intersecting both cascades consumes one root-budget slot and may populate both batches.
- Analytic-only roots do not resolve geometry, construct depth parts, or enter mapped batches.
- A zero-mapped plan performs no target allocation, layer attachment, clear, caster program bind,
  instance upload, or PSSM receiver activation.

#### Task Checklist

- [x] Introduce the composite N/M policy and validation.
- [x] Implement candidate ranking and tier selection.
- [x] Integrate mapped batch formation and analytic proxy creation.
- [x] Preserve selected-root liveness and expansion-cache reuse.
- [x] Add budget rejection and per-tier metrics.
- [x] Implement and verify the empty-mapped fast path.

#### Decisions and Course Corrections

- Staging began at N=128/M=128 so the preset did not drop selected shadows before the analytic
  receiver landed. Harness overrides exercised disjoint tiers; manual review subsequently selected
  N=32/M=8 as the committed defaults.
- The existing all-cascade query owner now resolves rigid bounds and identity once, sorts only when
  a mapped/selected boundary needs ordering, expands mapped roots only, and publishes analytic root
  shapes without geometry resolution.
- Ranking is camera-frustum membership, squared distance to the nearest bounds point, then stable
  producer identity. Tests prove an off-screen nearer root loses to in-frame roots and an identity
  tie is deterministic.
- A zero mapped budget with a valid caster performs the two bounded scene queries but no geometry
  expansion, target allocation, layer attachment/clear, program compilation, upload, or receiver
  activation. The analytic root still enters animation liveness.
- The implementation function was renamed around view-level shadow planning. PSSM batch/run types
  remain in `outdoor-pssm-casters.ts` because they are still a narrow colocated consumer; Phase 8
  will decide whether a file rename improves navigation enough to deserve the churn.

### Phase 4: Resteer the Root Budget Against Real Work

#### Deliverables

- Dry-run the remaining phases against the landed planner contracts and shader inputs.
- Compare unlimited/pre-change work with several provisional N/M pairs in the representative scene.
- Report selected/rejected roots, mapped/analytic roots, mapped parts, triangles, runs, instance
  upload bytes, PSSM CPU/GPU time, terrain GPU time, and whole-frame behavior.
- Inspect the worst retained roots by parts and triangles to determine whether root count provides a
  stable enough cost ceiling for the actual data distribution.
- Re-estimate net production sLOC and identify any duplicated selection, projection, or shadow-shape
  vocabulary before adding the hybrid receiver.

#### Decision Gate

- Continue with root budgets if decreasing M produces a monotonic and operationally meaningful
  reduction in mapped parts/uploads/shadow time across the representative population.
- If a small number of roots defeat the budget, pause and replace the root proxy with the narrowest
  measured complete-root cost policy. Do not add partial-actor truncation or a general adaptive
  scheduler.
- If the implementation has crossed or is projected to cross 700 net new production lines, stop
  and collapse the design before proceeding.

#### Task Checklist

- [x] Profile provisional root budgets on the representative population.
- [x] Inspect the available fixture's part/triangle distribution and document its limitation.
- [x] Dry-run Phases 5-7 against the landed contracts.
- [x] Record the decision to retain or replace root-count budgeting.
- [x] Record cleanup and sLOC findings.

#### Decisions and Course Corrections

- One-sample real-GPU gate measurements on the same 112x61 session shape were monotonic: M=16
  produced 1,952 records / 156,160 upload bytes / 0.548 ms mean PSSM CPU / 0.0155 ms mean PSSM GPU;
  M=32 produced 3,904 / 312,320 / 1.060 ms / 0.0217 ms; M=64 produced 7,808 / 624,640 /
  1.490 ms / 0.0371 ms. These are structural gate measurements, not Phase 7 acceptance statistics.
- Root count is retained as the first scheduling proxy. The synthetic fixture intentionally has no
  part or triangle outliers, so the decision remains conditional on the user's live crowd review;
  mapped part/upload metrics make any dishonest root visible without inventing a weighted scheduler.
- The current implementation is approximately +415 net production lines. The height-aware analytic
  record/evaluator, receiver-local selection changes, hybrid terrain variant, and integration are
  projected to bring the honest implementation to roughly +600-700 net lines.
- The tech lead approved raising the approximate implementation ceiling from +500 to +700
  production lines on 2026-09-01. Preserve the accepted height-derived design; this is not license
  to add general scheduling machinery or exceed the revised gate without another resteer.

### Phase 5: Replace Outdoor Grounding with Directional Analytic Shadows

#### Deliverables

- Split shared immutable caster-shape facts from indoor-grounding and outdoor-directional-shadow
  projections without introducing a universal shadow-policy abstraction.
- Carry and consume rigid caster height.
- Replace outdoor circular influence bounds with projected-capsule bounds.
- Add a fixed-capacity GPU record contract for the outdoor directional evaluator.
- Implement sun-aligned soft-capsule distance evaluation and strongest-overlap selection.
- Cut `simple` mode outdoor terrain over to the directional evaluator; leave indoor shells on radial
  grounding.
- Rename settings, symbols, tests, diagnostics, controls, and UI labels whose old “shared
  grounding” meaning is no longer true.

#### Acceptance Criteria

- Analytic shadow direction matches the resolved PSSM direction at every tested sun azimuth and
  elevation.
- Caster height changes projected length; maximum height and cast length bound it independently.
- Every analytic record field has a named shader consumer.
- Influence bounds contain the complete projected shape and admit the same border caster to both
  intersected terrain landblocks.
- At most eight analytic casters are evaluated by one terrain receiver; overflow remains
  deterministic.
- `simple` mode allocates no PSSM resources and renders no circular outdoor grounding.
- Indoor grounding appearance and scope/island selection remain unchanged.

#### Task Checklist

- [x] Extract shared rigid caster-shape facts.
- [x] Add projected analytic proxy and influence bounds.
- [x] Add fixed GPU records, bindings, and shader evaluation.
- [x] Cut simple outdoor terrain over to directional shadows.
- [x] Verify border, slope, height, sun-angle, and overflow behavior.
- [x] Sweep obsolete outdoor-grounding vocabulary.

#### Decisions and Course Corrections

- Rigid pose is resolved once into a shared shape plus an optional indoor radial projection and an
  outdoor-membership fact. Simple outdoor shadows no longer derive any shape fact from the indoor
  influence policy.
- The projected outdoor record is a fixed-capacity terrain-only capsule: contact anchor/radius plus
  a sun-aligned endpoint. Height-derived length and receiver influence share the Phase 2 projection
  caps, and receiver overflow remains deterministic at eight records.
- Outdoor capsule appearance initially remained authored frontend tuning rather than becoming
  seven new frame settings or UI controls. That budget-driven compromise was superseded after
  visual review exposed that the adjacent indoor controls no longer tuned outdoor shadows.

### Phase 6: Integrate the Hybrid Terrain Receiver

#### Deliverables

- Add a terrain receiver variant capable of consuming PSSM plus a nonempty analytic fallback set.
- Combine the two disjoint caster tiers as regional-sun visibility using strongest occlusion.
- Select PSSM-only, analytic-only, hybrid, or ordinary terrain programs from actual per-landblock
  records and active mapped state; do not evaluate empty analytic loops.
- Keep Buildings on PSSM-only programs and far terrain on shadow-free programs.
- Make ordinary contribution resolution consume the planner-owned analytic proxies and tier
  identities without re-ranking or re-deriving sun projection.
- Verify flat, portal, transition, mode-cycle, target-resize, and renderer-destruction scheduling.

#### Acceptance Criteria

- `shadow-maps` renders at most M mapped roots and uses analytic directional shadows for selected
  roots M through N-1 on eligible near terrain.
- No identity appears in both tiers, and one actor cannot double-shadow itself.
- Overlap between different mapped and analytic actors is no darker than the strongest applicable
  regional-sun occlusion.
- Ambient, dynamic/static lights, detail, fog, and color grade are unchanged by both outdoor
  mechanisms.
- Terrain with no analytic records uses no analytic uniforms or fragment loop.
- A view with no mapped casters samples no PSSM texture, including when a stale target generation is
  retained for reuse.
- Portal views obey independent per-view budgets without stale tiers leaking between views.

#### Task Checklist

- [x] Add the hybrid terrain shader/program contract.
- [x] Route planner-owned analytic records into terrain preparation.
- [x] Implement strongest-occlusion regional-sun composition.
- [x] Preserve PSSM-only Buildings and shadow-free far terrain.
- [x] Verify all mode, portal, transition, empty, and resource lifecycles.

#### Decisions and Course Corrections

- Terrain is partitioned by actual nonempty per-landblock analytic records. Ordinary/PSSM-only
  landblocks compile and draw without the capsule evaluator; directional/hybrid landblocks bind the
  fixed record set. Portal terrain routing remains a one-time authority, with later program groups
  binding the already-selected outdoor tile.
- Hybrid visibility uses `min(mapped, analytic)` only on regional-sun diffuse. Ambient and authored
  runtime lights stay in the unshadowed term, matching the existing PSSM receiver contract.
- The real-browser fixture linked ordinary, PSSM, directional, and hybrid terrain programs without
  GL errors. Flat and portal 112x61 crowd cycles proved `none` and `simple` retain zero PSSM bytes,
  two-cascade resize generations dispose exactly once, and view-local state does not leak across
  portal scheduling.

### Phase 7: Diagnostics, Manual N/M Tuning, and Acceptance

#### Deliverables

- Extend opt-in renderer profiling with candidate count, selected/rejected count, mapped/analytic
  root count, mapped parts/triangles/runs/upload bytes, and empty-fast-path count.
- Extend the Explorer Frame panel and browser-harness compact output only with metrics that
  distinguish a tuning or regression scenario.
- Expose N and M in the existing shadow controls and complete JSON harness settings.
- Capture repeated same-session real-GPU comparisons for representative N/M pairs with identical
  content, camera, viewport, render scale, AO, and effective settings.
- Capture daytime, minimum-elevation, low-sun, camera-edge, crowded-border, and portal-view
  screenshots or deterministic visual fixtures.
- Present the evidence and candidate settings to the user; the user chooses the shipped N/M values.

#### Acceptance Criteria

- Every metric differs in at least one documented tuning scenario and has a named diagnostic
  consumer.
- At least five repeated measurements support the chosen N/M pair; report medians and spreads with
  the complete workload.
- Lowering M monotonically reduces mapped depth work in the representative population.
- Raising N cannot increase mapped roots when M is unchanged, though it may increase analytic
  selection work.
- The user accepts detailed-near/fallback-far appearance, bounded off-screen pop-in, and final N/M.
- No captured page, shader, framebuffer, or WebGL errors occur.

#### Task Checklist

- [x] Add narrowly consumed selection and tier diagnostics.
- [x] Expose runtime N/M controls and harness settings.
- [ ] Run repeated real-GPU N/M comparisons.
- [ ] Perform sun-angle, camera-edge, crowd, border, and portal visual review.
- [x] Record the user-selected N/M values and evidence.

#### Decisions and Course Corrections

- Manual Explorer review selected N=32/M=8. The exact values remain frontend tuning rather than a
  renderer invariant; the composite policy continues to enforce only `0 <= M <= N` and its safety
  ceiling.

### Phase 8: Cleanup and Durable Documentation

#### Deliverables

- Delete superseded selector paths, circular outdoor-grounding shaders/settings, fixed caster
  padding, unused cascade capacity, obsolete fixtures, and compatibility shims.
- Sweep surviving terminology so outdoor directional analytic shadows, indoor grounding, mapped
  casters, and selected caster roots have unambiguous names.
- Recheck touched hot paths for avoidable allocation, repeated transforms, and duplicated derived
  facts.
- Remove temporary censuses and probes that have no durable consumer.
- Update `docs/lighting.md` with the bounded hybrid outdoor policy, receiver limitations, two
  cascades, analytic fallback, and accepted pop-in.
- Update this plan's status, task checklists, decisions, course corrections, final measurements,
  and remaining debt.

#### Acceptance Criteria

- No old outdoor-grounding, fixed-padding, or three/four-cascade vocabulary survives in active
  code, controls, diagnostics, tests, or durable documentation.
- Every settings field and retained metric has a named runtime or diagnostic consumer.
- Production code is at or below the Phase 4 accepted sLOC budget and contains no temporary tuning
  branch.
- Formatting, static checks, lint, tests, browser harnesses, and Rust checks pass.
- Durable lighting documentation describes the landed implementation rather than this working
  plan's discarded alternatives.

#### Task Checklist

- [x] Delete superseded paths and temporary diagnostics.
- [x] Sweep vocabulary and comments.
- [x] Review allocations, derived facts, and sLOC.
- [x] Update durable lighting documentation and this plan.
- [x] Run the complete verification matrix.

#### Decisions and Course Corrections

- Outdoor capsule appearance was initially collapsed to authored frontend tuning rather than seven
  mutable frame fields. This preserved the original +700 ceiling but produced an inadequate tuning
  workflow and was later replaced by the complete validated runtime composite.
- Shared rigid transforms are computed once per ordinary visible actor. The shadow-map planner owns
  tier ranking and the common projection; ordinary contribution resolution consumes its analytic
  shapes without repeating either decision.
- Final verification passed all 1,834 TypeScript tests, Svelte/TypeScript static checks, ESLint,
  dead-export analysis, Prettier, terrain-shader validation, Rust check, and clippy with warnings as
  errors. After exposing the complete tuning surface, the production diff is +839 net lines by the
  retired Phase 4 counting rule. Flat and portal crowd
  harness cycles plus the WebGL fixture completed without captured page, shader, framebuffer, or
  WebGL errors.
- Post-acceptance visual review added one live outdoor analytic `Tail strength` scalar. Capsule
  strength remains full through its first half and smooth-fades to that endpoint value; the default
  was manually tuned to 0.5. Follow-up review then exposed the full outdoor directional policy and shared projection
  controls in Explorer. The tech lead explicitly retired the sLOC ceiling rather than retain a
  misleading partial tuning surface.

## Verification Matrix

### Pure and Unit Tests

- projection resolution and finite angle limits;
- two-cascade splits, overlap, stable fits, bounded query reach, and frustum containment;
- settings validation and `M <= N`;
- camera-priority, nearest-bounds ranking, stable ties, overflow, and cascade-union membership;
- complete-root tiering and no analytic depth expansion;
- analytic capsule distance, softness, height/length caps, vertical receiver rejection, and
  conservative influence bounds;
- landblock-border selection and receiver-local capacity;
- strongest-occlusion combination and disjoint mapped/analytic identity sets;
- empty mapped/analytic combinations and mode transitions.

### WebGL and Browser Fixtures

- two-layer depth-array allocation, attachment, resize, disable, and destruction;
- no mapped casters: no allocation on a fresh renderer and no clear/sample on a retained target;
- nonempty mapped tier: material-free depth program, valid instance ranges, and two complete layers;
- analytic-only and hybrid terrain program linkage, exact uniforms, and zero-record behavior;
- PSSM-only Buildings and shadow-free far terrain;
- flat and portal frames, portal-transition snapshots, resize, context/resource teardown, and mode
  cycling;
- deterministic population fixtures at `N-1`, `N`, `N+1`, `M-1`, `M`, and `M+1` roots;
- visual captures at midday, minimum shadow elevation, low authored sun, camera edge, terrain border,
  dense crowd, and mixed mapped/analytic overlap.

### Commands

Run project scripts from `apps/holtburger-3d`:

```text
npm run format:check
npm run check
npm run lint
npm run test:ts
npm run harness:browser -- <targeted synthetic and production fixtures>
```

Run Rust verification from the repository root using package-manager scripts where available; for
direct workspace checks retained by the project:

```text
cargo test -p holtburger-core -p holtburger-3d-host
cargo clippy -p holtburger-core -p holtburger-3d-host --all-targets -- -D warnings
```

Performance acceptance must use `--gpu`, `--profile-renderer`, a random or explicitly isolated Vite
port, identical workload facts, at least five repeated runs, and medians plus spreads. SwiftShader
results and the two zero-caster sanity captures are not performance evidence.

## Risks and Mitigations

| Risk                                                     | Consequence                                                                | Mitigation                                                                                                                               |
| -------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Root count poorly predicts depth cost                    | N/M is bounded but frame time still spikes on part-heavy actors            | Retain part/triangle/run/upload metrics; inspect outliers at Phase 4 and replace only the proxy if evidence requires it                  |
| Two cascades expose resolution loss or seams             | Nearby quality improves at the expense of visibly unstable middle distance | Retune the one split and map distance; do not restore a third cascade without user-approved evidence                                     |
| Camera-priority omits a nearby off-screen occluder       | A shadow pops at a screen edge                                             | Admit off-screen roots after in-frame roots within the same bounded light volumes; accept the declared omission before adding state      |
| Tier order chatters near N or M                          | Detailed and analytic shapes visibly switch                                | Use deterministic bounds distance and identity; add hysteresis or a short transition only if captured motion proves it necessary         |
| Mapped and analytic shapes disagree                      | Tier changes expose direction or contact discontinuity                     | Resolve sun projection and rigid caster shape once; use the same anchor, radius, capped height, and direction in both consumers          |
| Analytic projection reaches unrelated terrain            | Long low-sun shadows cross cells or floors incorrectly                     | Cap height/cast length, keep a short vertical receiver interval, use conservative horizontal bounds, and remain terrain-only             |
| Hybrid receiver darkens overlapping shadows twice        | Crowds produce black patches                                               | Use disjoint caster sets and combine regional-sun visibility by minimum/strongest occlusion rather than multiplying attenuation          |
| Hybrid shader penalizes terrain without fallback casters | The optimization moves cost from the shadow pass into every terrain pixel  | Select the hybrid program only for receivers with nonempty analytic records; retain PSSM-only and ordinary variants                      |
| Transient empty views churn target allocation            | Pop-in causes allocation hitches                                           | Allocate only after first mapped work, retain an existing generation across transient emptiness, and release on mode disable/destruction |
| Refactor breaks animation liveness                       | Off-screen mapped or analytic shadows freeze                               | Union both retained tiers into the existing selected-dynamic feedback and cover off-screen fixtures                                      |
| Portal views leak tier state                             | One scope/view samples another view's records                              | Own plans and budgets per rendered view and clear active records at every view boundary                                                  |
| Settings become a bag of coupled scalars                 | Invalid combinations or duplicated decisions spread                        | Use validated budget/projection composites and carry derived facts in the frame-owned plan                                               |
| Historical docs preserve dead semantics                  | Future work follows circular outdoor grounding or 3-4 cascade assumptions  | Sweep active vocabulary and update `docs/lighting.md`; leave completed plans as historical records                                       |

## Definition of Done

- [ ] Every rendered view retains at most N eligible outdoor caster roots and maps at most M.
- [ ] N/M are one validated composite, analytic capacity is derived, and the user has selected the
      shipped values from repeated representative measurements.
- [ ] Outdoor caster reach is derived once from the resolved effective sun plus measured height and
      cast-length caps; fixed padding is gone.
- [ ] PSSM has exactly two supported cascades throughout policy, shaders, targets, controls, tests,
      and documentation.
- [ ] Empty mapped tiers allocate no first target and perform no clears, depth draws, uploads, or
      receiver sampling.
- [ ] Mapped roots alone expand into depth parts; analytic-only roots use rigid shape facts without
      geometry expansion.
- [ ] Hybrid outdoor terrain receives PSSM plus directional analytic fallback with disjoint caster
      membership and strongest regional-sun occlusion.
- [ ] `simple` outdoor terrain uses directional analytic shadows; indoor EnvCell grounding remains
      radial and behaviorally unchanged.
- [ ] Buildings remain PSSM-only, far terrain remains shadow-free, and no unrelated object shader
      gains analytic work.
- [ ] Flat, portal, transition, resize, mode-cycle, empty-scene, and destruction paths retain no
      stale state or resource leaks.
- [ ] Root/part/triangle/run/upload metrics prove the chosen budget bounds the representative scene;
      any contrary outlier has been resolved or explicitly accepted.
- [ ] Camera-edge, low-sun, terrain-border, dense-crowd, and tier-transition visuals are accepted,
      including the declared off-screen pop-in.
- [ ] `npm run format:check`, `npm run check`, `npm run lint`, and `npm run test:ts` pass.
- [ ] Targeted and production browser harnesses pass on real GPU without page, shader, framebuffer,
      or WebGL errors.
- [ ] Relevant Rust tests and clippy with warnings denied pass.
- [ ] Temporary diagnostics are removed, durable diagnostics have named consumers, and
      `docs/lighting.md` describes the landed design.

## Open Questions

1. What N/M pair should ship? The user will choose this in Phase 7 from manual visual and repeated
   performance tuning; the plan intentionally supplies no guessed defaults.
2. Does the reproduced caster-height distribution support one projection-height cap for all actor
   classes, or does a proven giant-creature outlier require a category-independent clamp policy?
   Phase 2 answers this from rigid bounds rather than assumptions.
3. Is deterministic tier popping acceptable in motion? It is accepted provisionally. Only a
   captured objectionable transition may authorize hysteresis or blending.
4. Does root count remain an honest cost proxy after two cascades and the representative population?
   Phase 4 is the mandatory gate before considering a weighted complete-root budget.
