# Holtburger 3D Near-Field SAO Plan

Status: Completed
Branch: `feat/holtburger-3d-sao`
Created: 2026-08-11

## Context and Boundaries

### Goal

Add a renderer-local, near-field Scalable Ambient Obscurance pass that gives nearby opaque geometry
stable contact shading in both flat and portal views with a bounded, visually acceptable overlap
with authored distance fog.

### In Scope

- A WebGL2 SAO implementation owned entirely by `apps/holtburger-3d`.
- One renderer-owned flat-scene target containing opaque color and sampleable depth on every frame;
  portal mode retains its existing scope-atlas color/depth ownership.
- Depth-reconstructed view-space positions and normals; no geometry normal attachment in the first
  version.
- Full-resolution obscurance, depth-aware separable blur, and a full-resolution presentation pass.
- A smooth renderer-owned camera-distance fade independent of authored fog.
- The same SAO algorithm for flat opaque output and every selected portal scope-atlas tile.
- Occlusion casting and receiving by terrain and every opaque or alpha-tested object submission,
  including static geometry and dynamic entities.
- Preservation of resolved depth so existing transparent objects and particles retain their current
  depth and ordering contracts.
- Explorer enable/disable control, renderer diagnostics, GPU phase attribution, and browser-harness
  visual/performance evidence.
- Explicit documentation of the deliberate retail presentation divergence.

### Out of Scope

- A general render graph, generic post-processing framework, or Three.js/postprocessing dependency.
- Deferred shading, physically based rendering, or changing the retail-derived forward-lighting
  equations.
- A geometry-authored normal buffer, material/lighting classification buffer, or MRT conversion.
- Temporal accumulation, motion vectors, reprojection, denoising history, or temporal antialiasing.
- Ambient occlusion on transparent objects, particles, weather, celestial geometry, or empty sky
  pixels.
- Shadow maps, ray-traced AO, baked AO, or authoring new static client data.
- Changing portal topology, scope selection, atlas planning, propagation, or envelope semantics.
- Changing camera projection, depth formats, fog resolution, weather behavior, or material order
  except for the clean flat-renderer cutover through its scene target and presentation step.
- Modifying the legacy app, ACE, ACViewer, or the retail client decompile.

## Ground Truth

### Current Renderer Contracts

- `apps/holtburger-3d/src/lib/game/renderer/webgl2-device.ts`
  - creates a raw WebGL2 context with antialiasing disabled; there is no Three.js renderer or
    post-processing composer to extend.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - owns the frame schedule and all flat/portal output routing;
  - flat rendering currently draws directly into the default framebuffer;
  - flat rendering duplicates its physical schedule across `#drawView` and `#drawProfiledView`,
    despite the phase submission helpers already accepting a nullable profile capture;
  - portal rendering writes scope-local opaque color/depth into an atlas, resolves it into the
    default framebuffer, then draws deferred transparent objects and particles;
  - the after-landscape sky/weather pass occurs after terrain and opaque objects but before
    deferred translucency.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-scope-atlas-targets.ts`
  - establishes the transactional render-target allocation pattern and the existing RGBA8 plus
    `DEPTH_COMPONENT24` opaque scene contract.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-scope-atlas-programs.ts`
  - establishes exact portal resolve behavior: selected scope color is copied and selected scope
    depth is written through `gl_FragDepth`.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-object-program.ts` and
  `apps/holtburger-3d/src/lib/game/renderer/webgl2-terrain-program.ts`
  - prove that authored normals reach the forward-lighting shaders but no normal attachment is
    retained after the opaque pass.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-gpu-frame-profiler.ts`
  - owns non-nesting elapsed-time GPU phase attribution and delayed/disjoint query handling.
- `apps/holtburger-3d/src/lib/frontend-tuning.ts`
  - owns discoverable renderer constants and default presentation policy.
- `apps/holtburger-3d/src/harness/browser` and `apps/holtburger-3d/scripts/browser-harness.mjs`
  - provide the canonical non-interactive browser/GPU verification path.

### Retail Compatibility Evidence Required Before Default Enablement

SAO is a modern presentation feature, not a behavior inferred from authored AC data. Before the
feature can default on, confirm the retail opaque/deferred presentation schedule from
`acclient-eor-source/acclient.c` and record the absence of an equivalent screen-space obscurance
stage at the renderer integration point. The production integration must carry a `RETAIL
DIVERGENCE:` comment with:

- the relevant `acclient.c` render-schedule citations;
- the visible consequence of removing SAO;
- a screen-coverage census from the representative harness captures, reporting the fraction of
  non-sky pixels eligible for AO before and after the renderer-owned distance fade.

That evidence, the real-GPU gate, and the transition-portal motion gate are complete. SAO is now
enabled by default while retaining an explicit user disable switch.

## North Stars

1. SAO is optional presentation policy; it does not alter world, content, material, or portal
   semantics.
2. Flat output and portal scope tiles feed one screen-space obscurance contract after every opaque
   and alpha-tested submission, including dynamic entities, but before weather or deferred work.
3. Nearby contact shading is the product goal. Distant pixels should be cheap, stable, and
   indistinguishable from SAO-disabled output.
4. SAO owns one stable near-field range independently of authored fog. Minor multiplication of
   already-fogged opaque color is accepted for v1; fog must never disable nearby contact shading.
5. Preserve depth exactly across presentation. Deferred objects and particles must observe the same
   static and dynamic opaque depth they observe without SAO.
6. Keep invalid settings unrepresentable. Renderer-owned full-strength and disabled distances
   travel as one validated fade rather than frontend-authored scalar fields.
7. Keep one render schedule in each mode. The flat-scene target is unconditional; only SAO scratch
   resources and work are conditional, transactionally resized, and explicitly torn down.
8. Prefer a deterministic spatial kernel over temporal machinery. Camera motion must not introduce
   noise shimmer or history ghosts.
9. Measure before tuning. Constants earn their values through named harness scenes and real-GPU
   profiles rather than diagnostic aesthetics alone.
10. Do not manufacture a general abstraction for one proven pass.

## Accepted First-Version Shape

### Frame Policy

- Add one explicit ambient-occlusion enablement choice plus appearance parameters to `FrameSettings`
  and the Explorer control path.
- Keep shader tuning in one composite `SHARED_FRONTEND_TUNING.rendering.ambientOcclusion` value. Its fields
  must have named shader, allocation, distance-resolution, or diagnostic consumers.
- Keep distance eligibility in one renderer-owned validated policy:
  - `fullStrengthUntil`: AO is not distance-attenuated before this linear view distance;
  - `disabledAt`: AO smoothly reaches zero at this linear view distance.
- Use the validated renderer-owned fade unchanged on every enabled frame. Authored fog does not
  reshape AO eligibility or disable its scratch resources.
- The AO sample radius remains a separate world-space quantity. It controls neighborhood scale,
  not camera-distance eligibility.

### Common Ownership and Optional Stage

- Flat rendering always uses its scene target and presentation step. Delete the direct-to-default
  flat route after the cutover is proven.
- Portal rendering always uses its existing scope atlas and resolve path.
- SAO enablement controls one stage between opaque geometry and weather. Disabled frames skip that
  stage and own no SAO scratch targets; they do not select another frame schedule.
- Scene selection, contribution preparation, and physical world-draw boundaries are identical in
  enabled and disabled frames.

### Flat GPU Schedule

1. Resize or reuse a drawing-buffer-sized flat-scene target with RGBA8 color and sampleable D24
   depth.
2. Route the existing before-world sky, terrain, and every opaque/alpha-tested object submission
   into that target. Static and dynamic objects share the existing opaque phase and both
   participate.
3. When enabled, evaluate obscurance from flat-scene depth into a resolution-scaled single-channel
   target. Sky/clear depth and pixels at or beyond `disabledAt` return neutral occlusion before
   neighborhood sampling.
4. When enabled, apply depth-aware horizontal and vertical filtering, then multiply the filtered
   factor into the flat-scene color attachment without sampling that color attachment.
5. Draw the existing after-landscape sky/weather pass into the now-occluded flat-scene target.
6. Present scene color to the default framebuffer and write sampled scene depth through
   `gl_FragDepth`.
7. Continue the existing deferred transparent-object and particle schedule against the restored
   default-framebuffer depth.

### Portal GPU Schedule

1. Keep the existing scope-atlas target allocation, planning, and opaque routing.
2. Draw the before-world sky into the outdoor tile, terrain, and every static/dynamic
   opaque/alpha-tested object submission into its selected scope tile.
3. When enabled, before after-landscape weather, evaluate and filter SAO for every selected scope
   tile. Consume planner-owned atlas and screen rectangles for tile-local view-position
   reconstruction; reject evaluation samples outside their owning tile and clamp the fixed blur
   footprint within it.
4. When enabled, multiply each tile's filtered factor into the existing atlas scene color without
   sampling that color attachment.
5. Draw the existing after-landscape sky/weather pass into the outdoor tile.
6. Run the existing portal propagation, envelope, and color/depth resolve into the default
   framebuffer unchanged.
7. Continue the existing scope-constrained deferred transparent-object and particle schedule.

The renderer invokes SAO as an external consumer of the prepared atlas frame and scene target. SAO
owns any tile-metadata upload it needs and explicitly invalidates the portal tile-state cache before
weather resumes. No SAO command, resource, or vocabulary enters portal culling, planning, opaque
routing, propagation, envelope reduction, the command model, or the resolve executor.

The first version intentionally reconstructs normals from neighboring view-space positions. This
avoids modifying every opaque material variant and the portal atlas attachment contract. The known
cost is weaker stability at silhouettes, thin geometry, and depth discontinuities; the bilateral
filter and near-field policy must make that concession acceptable in the harness gates.

Applying SAO before the existing after-landscape pass is deliberate: weather is an overlay, not an
opaque occluder or receiver. Portal weather remains in the outdoor scope tile before final resolve,
so its existing scope confinement and presentation order are preserved. Transparent objects and
particles remain after presentation/resolve and likewise cannot cast or receive SAO.

## Phased Implementation

### Phase 0: Establish Evidence and Baselines

#### Deliverables

- Record the retail render-schedule evidence and the intended `RETAIL DIVERGENCE` citation.
- Select deterministic browser-harness poses covering:
  - nearby outdoor terrain/object contact;
  - a sealed interior with shell/resident contacts;
  - a dynamic opaque entity contacting terrain and interior geometry;
  - an indoor-root portal view containing outdoor and indoor scopes;
  - an outdoor-root portal view containing an interior;
  - authored near fog to assess the accepted AO/fog overlap;
  - emissive geometry, alpha-tested geometry, transparent objects, particles, and weather.
- Capture SAO-disabled screenshots and renderer profiles at fixed drawing-buffer dimensions and DPR.
- Record target bytes and mean GPU phase timings on SwiftShader for deterministic regression
  context and on the real GPU for performance evidence.
- Agree on a real-GPU budget for the unconditional flat target/presentation tax before the clean
  cutover removes the direct route.

#### Acceptance Criteria

- Every named visual risk has a reproducible camera pose or synthetic fixture.
- Baselines state browser/WebGL renderer, drawing-buffer extent, DPR, frame settings, and portal
  mode.
- The retail evidence is strong enough to write the required divergence marker without guessing.
- No production rendering behavior changes in this phase.

#### Task Checklist

- [x] Confirm and cite the retail opaque/weather/deferred frame order.
- [x] Add or record deterministic harness poses for the required scene matrix.
- [x] Capture baseline screenshots, selection metrics, target bytes, and GPU timings.
- [x] Record the accepted disabled-mode flat target/presentation budget.
- [x] Define the eligible-pixel coverage census used by the divergence marker.
- [x] Record findings and adjust later gates before implementation.

#### Decisions and Course Corrections

- Completed 2026-08-11.
- Retail schedule evidence:
  - `acclient-eor-source/acclient.c:296701-296729` (`LScape::draw`) calls the before-landscape sky,
    draws the visible landblocks, and then calls the after-landscape sky/weather variant.
  - `acclient-eor-source/acclient.c:297381-297434` (`GameSky::Draw`) establishes the weather overlay
    contract: the after-landscape variant draws `after_sky_cell` with depth comparison `ALWAYS` and
    depth writes disabled, then restores `LEQUAL` and depth writes.
  - `acclient-eor-source/acclient.c:441096` (`PView::DrawCells`) and
    `acclient-eor-source/acclient.c:138726` (`SmartBox::RenderNormalMode`) flush the alpha list after
    landscape/cell rendering.
  - No screen-space obscurance stage exists at these integration points. The production marker can
    therefore cite this schedule as a deliberate presentation divergence without inferring retail
    behavior.
- Deterministic scene matrix:
  - Outdoor-root portal stress, dynamic opaque entities, transparent objects, particles, and dense
    terrain/object contacts: landblock `0xda55ffff`, radii `1`, explorer focus, particle seed `7`.
  - Sealed indoor root: landblock `0x7d64ffff`, environment cell `0x7d64010e`, position
    `24089.25,13.6,-19337.75`, yaw `180`, pitch `0`.
  - Hybrid indoor/outdoor portal view: landblock `0x7d64ffff`, environment cell `0x7d640113`,
    position `24078.5,13.7,-19328.25`, yaw and pitch `0`.
  - Alpha-tested and transparent material coverage: browser fixture `--fixture instanced`.
  - Weather A/B: DA55 with `--day-group 3`, compared with `--no-weather`.
  - Close emissive/particle coverage: DA55 at `42087,37.9,-16638.4`, yaw and pitch `0`, radii `1`,
    particle seed `7`.
  - Authored-fog coverage uses the fixed DA55 pose and time-of-day so the resolved scene fog, not a
    diagnostic substitute, drives the distance cap.
- Canonical profile settings are 1280x720 drawing-buffer pixels, DPR 1, fixed 16.6667 ms frame
  interval, capture frame 120, 3,000 ms measurement, and renderer profiling enabled.
- Baseline evidence:
  - Portal stress selected 39 scopes and 44 crossings, covered 948,884 atlas-tile pixels, rendered
    26 visible dynamic entities/153 parts, and reported 71,884,800 portal-target bytes.
  - SwiftShader portal context: GPU total 249.345 ms (terrain 85.870 ms, opaque 36.339 ms, portal
    composition 125.953 ms, blended 0.892 ms, particles 0.290 ms); CPU mean 5.138 ms, p95 9.5 ms.
    These figures are deterministic regression context only, not performance evidence.
  - RX 7900 XT portal context: GPU total 1.934 ms (terrain 0.194 ms, opaque 1.235 ms, portal
    composition 0.451 ms, blended 0.041 ms, particles 0.013 ms); CPU mean 1.558 ms, p95 1.9 ms.
  - RX 7900 XT flat context: GPU total 2.421 ms (opaque 2.307 ms, terrain 0.074 ms, blended
    0.029 ms, particles 0.012 ms); CPU mean 2.488 ms, p95 2.9 ms.
  - RX 7900 XT indoor-root portal context selected six scopes, rendered five dynamic entities/ten
    parts and 51 static draws, and measured GPU total 0.708 ms (opaque 0.642 ms, portal composition
    0.035 ms, blended 0.019 ms, particles 0.012 ms); CPU mean 0.232 ms, p95 0.3 ms.
  - Baseline captures are `/tmp/holtburger-sao-baseline-outdoor.png` and
    `/tmp/holtburger-sao-baseline-indoor.png`. They are working evidence rather than repository
    artifacts; the final matched captures must be retained by the browser-harness evidence flow.
- The unconditional flat RGBA8 plus D24 scene target costs exactly eight texture bytes per
  drawing-buffer pixel: 7,372,800 bytes at 1280x720 and 16,588,800 bytes at 1920x1080, excluding
  negligible framebuffer-object bookkeeping. The accepted disabled-feature presentation-tax gate
  is at most 0.25 ms median GPU time at 1280x720 and 0.50 ms at 1920x1080 on the RX 7900 XT. Missing
  either gate blocks deletion of the direct flat path and requires an architectural resteer.
- Coverage census contract:
  - The denominator is every committed flat-scene pixel, or every pixel inside a selected portal
    tile, whose post-opaque depth differs from clear depth after terrain plus all static/dynamic
    opaque and alpha-tested submissions.
  - Report full-strength pixels at or before `fullStrengthUntil`, fading pixels strictly inside the
    effective fade, and distance-neutral pixels at or beyond `disabledAt` as fractions of that
    denominator. Report clear-depth sky separately rather than diluting the eligible denominator.
  - Portal mode counts each selected tile's own opaque pixels once and excludes atlas packing gaps.
    The before/after figure required by the divergence marker is the opaque-depth denominator
    before distance policy versus full-strength plus fading pixels after the configured fade.
- The Phase 2 profiled/unprofiled schedule collapse is a prerequisite, not opportunistic cleanup:
  SAO must be inserted into one physical schedule so profiling cannot preserve or create a second
  renderer path.

### Phase 1: Define and Prove the Near-Field Policy

#### Deliverables

- Add a colocated validated type and pure enablement resolver for the renderer-owned AO distance fade.
- Extend the immutable frame settings snapshot with one enablement choice.
- Add discoverable initial tuning for resolution scale, sample radius, bias, intensity, sample
  count, bilateral depth threshold, and renderer-owned distance fade.
- Add a shared CPU reference for depth linearization and distance weighting used by
  focused tests and harness expectations.
- Define a deterministic sample kernel whose orientation does not vary with frame time.

#### Acceptance Criteria

- Invalid or zero-width fade ranges fail loudly before reaching WebGL.
- The configured AO distance is preserved regardless of authored fog.
- Only explicit user disablement resolves to a disabled effective policy.
- Distance weight is exactly full before `fullStrengthUntil`, smooth inside the fade, and neutral at
  and beyond `disabledAt`.
- Sample radius and camera-distance eligibility remain independent facts.
- Frame settings tests prove the runtime forwards the complete immutable choice.

#### Task Checklist

- [x] Add the composite distance-fade type and validation.
- [x] Add the pure enablement resolver using the validated renderer-owned fade.
- [x] Add the single frame enablement field and validated default tuning.
- [x] Add pure depth/fade/kernel tests without duplicating runtime constants as test literals.
- [x] Update runtime fakes and fixtures through a clean contract cutover.

#### Decisions and Course Corrections

- Completed 2026-08-11.
- `ambient-occlusion-policy.ts` owns the validated branded distance fade, effective enabled/disabled
  policy, WebGL depth-linearization reference, smooth distance weight, and fixed concentric-spiral
  sample kernel. Rendering code cannot structurally manufacture a validated fade.
- Post-completion live review proved the earlier fog coupling disabled AO during a nighttime window:
  authored fog moved nearer than the 16-unit minimum fade width, so an enabled user setting still
  resolved to a disabled pass with zero scratch bytes. The coupling and its now-unused minimum-width
  wrapper were removed. Fog no longer participates in AO policy resolution. At time-of-day zero,
  the pre-retune flat regression harness retained its fixed 40-96 range and 1,843,200 active scratch bytes;
  the transition-portal harness retained the same range, six scopes/four crossings, four dynamic
  opaque draws, and 11,059,200 active scratch bytes. Both emitted no browser console messages.
  After the final 64-128 retune, the time-of-day-zero flat harness again retained 1,843,200 active
  scratch bytes and emitted no browser console messages.
- Initial tuning is deliberately conservative and provisional: half resolution, 12 fixed taps, a
  2-world-unit radius, 0.05 bias, 1.0 intensity, 0.75 bilateral depth threshold, a 40-to-96-unit
  configured distance fade. Phase 4 evidence owns changes to
  these values; their presence here is not a claim that they are visually final.
- `FrameSettings.ambientOcclusion` is a required immutable frame choice containing enablement and
  validated appearance parameters. The distance policy remains renderer-owned and is never
  frontend-authored. Enablement now defaults true after the completed visual/performance gates; the
  runtime forwarding test changes the complete choice without scene publication or reconstruction.
- Focused policy/runtime tests pass (15 tests), `npm run check` reports no TypeScript or Svelte
  diagnostics, and focused ESLint reports no findings.

### Phase 2: Cut Flat Rendering Over to Scene-Target Ownership

#### Deliverables

- Add `webgl2-flat-scene-target.ts` owning RGBA8 color, `DEPTH_COMPONENT24` depth, framebuffer,
  extent, byte accounting, transactional resize, and destruction.
- Add focused target lifecycle/format tests following the portal target-owner pattern.
- Route flat opaque output through the scene target and presentation step unconditionally while
  preserving the existing before-world, terrain, opaque static, opaque dynamic, alpha-tested,
  weather, deferred, and particle draw boundaries.
- Collapse `#drawView` and `#drawProfiledView` into one flat-view schedule taking a nullable profile
  capture. Route every phase through the existing nullable-profile submission helpers so profiling
  changes attribution only, never physical work or order.
- Add a minimal presentation program that copies color and writes sampled depth to the default
  framebuffer; use it initially to validate the target path before SAO math is introduced.
- Keep target/program ownership renderer-local and lazy.

#### Acceptance Criteria

- Every flat frame uses one scene target and presentation path; no direct-to-default compatibility
  route remains.
- The target/presentation cutover preserves flat color within the accepted screenshot tolerance
  before any SAO shader is introduced.
- The measured real-GPU and memory cost of the unconditional target/presentation path satisfies the
  Phase 0 budget before the direct route is deleted.
- Copied opaque depth passes a focused browser fixture and preserves transparent/particle occlusion
  in flat mode.
- Same-extent frames allocate nothing; resize replaces one complete generation; destroy releases
  every owned framebuffer, texture, vertex array, and program exactly once.
- Static and dynamic opaque submissions occur before presentation; weather, transparent objects,
  and particles retain their existing relative order.
- Profiled and unprofiled flat frames submit identical sky, terrain, opaque, weather, transparent,
  and particle work; only profiling clocks and queries differ.

#### Task Checklist

- [x] Implement and test transactional flat-scene target ownership.
- [x] Route flat opaque output to the scene framebuffer unconditionally.
- [x] Replace `#drawView` and `#drawProfiledView` with one nullable-profile flat schedule.
- [x] Add parity coverage proving profiling cannot add, omit, or reorder a render phase.
- [x] Implement the color/depth presentation program.
- [x] Verify pre-cutover versus scene-target output in the browser harness.
- [x] Delete the direct-to-default flat route and its stale state assumptions.
- [x] Record active bytes and lifecycle counts in renderer diagnostics.

#### Decisions and Course Corrections

- Completed 2026-08-11.
- `WebGL2FlatSceneTarget` owns one transactional RGBA8/D24 generation. Same-extent resize is a
  no-op; replacement publishes only after framebuffer completeness; failed replacement retains the
  previous generation and restores draw/read framebuffer plus texture bindings; destroy is
  idempotent. Four focused lifecycle/format tests cover these contracts.
- The former `#drawView` and `#drawProfiledView` schedules and the unprofiled-only preparation helper
  were deleted. `#drawFlatView` is the sole physical schedule and sends nullable profiling through
  the same sky, terrain, opaque, blended, and particle submission helpers.
- Flat rendering now always clears and draws opaque work into the scene target, draws weather
  there, presents exact texel-fetched color and sampled D24 depth to the default framebuffer, then
  runs transparent objects and particles against that restored depth. Presentation explicitly
  invalidates and rebuilds the object-state mirror before deferred work.
- `presentation` is a first-class GPU profiler phase because it is the only direct measurement of
  the unconditional optional-feature tax. Explorer diagnostics report its time, flat target bytes,
  live framebuffer count, and allocation/disposal generations.
- At 1280x720 the target reports exactly 7,372,800 bytes and presentation measured 0.031 ms on the
  RX 7900 XT. At 1920x1080 it reports exactly 16,588,800 bytes and presentation measured 0.051 ms.
  Both are comfortably inside the Phase 0 gates of 0.25 ms and 0.50 ms.
- The matched DA55 flat capture at `/tmp/holtburger-sao-flat-cutover.png` is visually unchanged from
  the baseline framing. It retains 1,222 static draws, 27 dynamic draws/163 dynamic instances, 20
  transparent draws/109 transparent instances, and 37 particle instances with profiling enabled.
  This simultaneously guards the historical profiled-path particle omission and exercises copied
  opaque depth in front of deferred content.
- The existing `--fixture instanced` harness case currently fails before presentation in
  `#prepareFrameInstanceRuns`: transparent generated-static fragments enter a path whose caller
  explicitly supplies no generated-culling view. Blame predates this branch and the SAO schedule
  does not alter that batching contract. The final SAO matrix will use authored DA55 alpha-tested
  and transparent content unless that independently owned fixture defect is repaired; it is
  recorded as pre-existing harness debt rather than silently fixed inside this renderer cutover.
- `FrameInput.views` remains a latent contract mismatch: flat previously accumulated views while
  portal already treated each view as a complete replacement, and production supplies exactly one
  primary view. The flat target now follows the complete-view model. A future multi-view feature
  must define composition semantics explicitly rather than inheriting either accidental behavior.
- Focused target, profiler, and runtime tests pass (22 tests); full TypeScript/Svelte checks and
  TypeScript lint are green. SwiftShader and real-GPU browser runs report no renderer console error.

### Phase 3: Implement SAO and Bilateral Filtering

#### Deliverables

- Add `webgl2-sao-pass.ts` owning:
  - the deterministic obscurance program;
  - horizontal bilateral blur;
  - vertical bilateral blur and multiplicative application;
  - one fullscreen vertex array;
  - two resolution-scaled single-channel targets with explicit lifecycle and byte accounting for
    flat and portal extents.
- Give the pass one explicit opaque-depth input contract supporting:
  - the complete flat drawing-buffer rectangle; and
  - planner-owned portal atlas/screen rectangles for selected scope tiles.
- Keep portal integration outside the compositor executor: the SAO pass owns its reusable tile
  metadata buffer, and the pipeline exposes only the narrow state invalidation needed before
  weather resumes.
- Reconstruct view-space position from depth and the active perspective projection.
- Reconstruct a stable local normal from neighboring positions, selecting derivatives that avoid
  crossing the largest local depth discontinuity.
- Reject clear-depth, malformed reconstructed depth, and out-of-range pixels before the sample loop.
- Treat samples at or beyond the effective disabled distance as unoccluding.
- Add `ambientOcclusion` as a first-class profiler GPU phase; do not fold it into opaque or portal
  composition time.

#### Acceptance Criteria

- Empty sky remains byte-for-byte neutral through SAO composition.
- Pixels beyond the effective disabled distance match the ordinary presentation path within the
  fixture tolerance and perform no neighborhood sample loop.
- The fade boundary produces no visible ring in a deterministic forward/backward camera sweep.
- Static and dynamic opaque geometry both contribute sampled depth and both have their color
  attenuated by the resulting obscurance.
- Portal tile reconstruction consumes planner-owned screen and atlas rectangles; kernels cannot
  sample a neighboring scope tile or atlas packing gap.
- Portal culling, planning, routing, propagation, envelope, command-model, and resolve-executor
  tests retain zero SAO concepts and unchanged execution traces.
- The flat presentation writes original opaque depth exactly enough for the existing depth
  equality/occlusion fixture and deferred rendering; portal resolution keeps its existing depth
  path.
- Profiling disabled performs no SAO timing-query work; profiling enabled attributes the complete
  obscurance/filter/composite schedule once.

#### Task Checklist

- [x] Implement and test resolution-scaled target extent/byte calculations.
- [x] Implement deterministic view-position and normal reconstruction.
- [x] Implement near-field obscurance with early neutral exits.
- [x] Implement horizontal and vertical depth-aware filtering.
- [x] Apply filtered AO after all static/dynamic opaque work and before weather in flat mode.
- [x] Apply filtered AO per selected scope tile after all static/dynamic opaque work and before
      outdoor-tile weather in portal mode.
- [x] Invalidate cached portal tile state after SAO without adding SAO to the portal executor.
- [x] Integrate flat color/depth presentation without changing portal resolve semantics.
- [x] Add profiler type, accumulation, display, and fixture coverage.

#### Decisions and Course Corrections

- Completed 2026-08-11.
- `WebGL2SaoPass` batches flat or planner-owned portal rectangles through one metadata UBO and one
  instanced exact-tile-quad schedule. Evaluation reconstructs view positions and conservative
  local normals from D24 depth, rejects clear/far/malformed pixels before the fixed sample loop,
  then runs separable five-tap depth-bilateral filtering in two configured-resolution R8 targets.
- The plan's proposed "vertical blur and multiplicative application" draw was split into vertical
  blur plus a dedicated composite draw. Sampling attached scene depth while writing back into the
  same scene framebuffer would create forbidden framebuffer feedback; detaching another owner's
  depth would also violate target ownership. The extra draw multiplies color with `ZERO` /
  `SRC_COLOR`, leaves depth untouched, and keeps one shared flat/portal SAO implementation.
- SAO runs after every terrain/static/generated/dynamic opaque and alpha-tested submission and
  before after-landscape weather. Deferred transparent objects and particles therefore neither
  enter the sampled depth nor receive the multiplicative attenuation. Portal planning, resolve,
  propagation, command routing, and executor contracts retain no SAO concept; the pipeline exposes
  only a narrow opaque-tile-state invalidation after its external atlas consumer.
- Scratch ownership is lazy and transactional: disabled frames own no generation, same extents
  reuse one generation;
  resize publishes only two complete R8 targets; allocation failure preserves the prior generation
  and caller framebuffer/texture bindings; disable and destroy release the active generation.
  Focused tests cover exact extent/bytes and enable/resize/failure/disable/destroy behavior.
- `ambientOcclusion` is a non-nesting first-class GPU phase. Profiling-off performs no query work;
  profiling-on attributes evaluation, both filters, and composite exactly once. Explorer frame
  diagnostics expose GPU time, effective fade, active bytes, and allocation/disposal generations.
- The initial half-resolution implementation measured 0.128 ms and owned 1,036,800 scratch bytes
  for flat SAO at 1920x1080 on the RX 7900 XT; outdoor portal SAO measured 0.250 ms and owned
  6,220,800 bytes for the fixed 2-by-3 atlas. Both were comfortably below the 2 ms Phase 4 gate.
  SwiftShader remains deterministic evidence only.
- Flat and indoor/outdoor portal captures show no black tiles, atlas seams, or weather corruption.
  Visual-strength, contact quality, fade census, emissive behavior, and motion acceptance remain
  Phase 4 decisions rather than being inferred from these structural captures.
- Focused policy, target, profiler, portal-state, runtime, and scratch tests pass; the full
  TypeScript/Svelte check is green after integration.

### Phase 4: Integrate Explorer Policy and Resteer on Visual Evidence

#### Deliverables

- Add an Explorer ambient-occlusion toggle under render quality, enabled by default.
- Surface effective distance range, active target bytes, and AO GPU time using existing diagnostics
  boundaries; do not add metrics without a scenario where they differ from an existing metric.
- Add an optional harness-only AO visualization/coverage mode showing neutral, faded, and
  full-strength pixels.
- Capture matched on/off screenshots and GPU profiles for every Phase 0 pose.
- Record the eligible-pixel census and complete the production `RETAIL DIVERGENCE` comment.
- Resteer before polish based on portal edges, dynamic-entity contacts, emissive surfaces, thin
  geometry, and motion sweeps.

#### Acceptance Criteria

- Toggling SAO changes the next frame without resource publication, scene rebuild, or renderer
  reconstruction.
- The effective distance cap visibly reaches neutral before authored fog in every fog case.
- Portal transitions show no tile seams, scope leakage, or discontinuity caused by the AO pass.
- Opaque dynamic entities cast and receive AO in both flat and portal views without a separate
  dynamic-only render path.
- Alpha-tested silhouettes, transparent objects, and particles preserve their established draw and
  depth behavior.
- Weather remains outside SAO. Emissive attenuation is either visually acceptable and recorded as a
  v1 concession, or the plan is explicitly resteered before default enablement.
- The real-GPU median SAO phase at 1920x1080 is at or below the initial 2 ms budget. A miss triggers
  measurement-led sample/resolution tuning or leaves the feature experimental; it does not invite
  unrelated renderer optimization.

#### Task Checklist

- [x] Add Explorer toggle plumbing and labels.
- [x] Add narrowly useful diagnostics and harness visualization.
- [x] Run the complete screenshot/motion/performance matrix.
- [x] Record coverage census and retail-divergence evidence.
- [x] Decide whether depth-derived normals satisfy the first-version quality bar.
- [x] Decide and verify the default enablement policy.
- [x] Dry-run the cleanup phase against the accepted implementation shape.

#### Decisions and Course Corrections

- Completed 2026-08-11.
- Explorer exposes one "Near-field ambient occlusion" render-quality toggle. It replaces the
  immutable frame setting and reaches the next frame without scene publication, content rebuild,
  or renderer reconstruction. The quality fieldset no longer incorrectly disables unrelated
  controls while anisotropy capability detection is pending.
- The retained harness-only `--ambient-occlusion-coverage` mode paints full-strength opaque pixels
  green, fading pixels yellow, distance-neutral pixels blue, and clear depth black. Its one-shot
  full-resolution R8 category target is synchronously read and immediately destroyed; ordinary AO
  frames perform neither the extra draw/allocation nor a readback. Direct D24 integer/float
  readback was rejected after SwiftShader returned backend-specific/unusable values without a
  console error; rendering byte labels through the same classification shader is portable and
  makes the census agree with visible categories.
- DA55 flat overview census: 910,846 opaque pixels, with 483,737 fading (53.1%), 427,109 neutral
  (46.9%), and zero full-strength from the elevated camera; 10,754 clear pixels are reported
  separately. DA55 portal census: 938,104 opaque pixels, with 26,948 full-strength, 483,737 fading,
  and 427,419 neutral, plus 10,780 clear. Their sum is exactly the planner's 948,884 committed tile
  pixels, proving atlas gaps and unselected scopes are excluded.
- After the retained defaults were retuned to 64-128, a fresh DA55 outdoor-root portal census
  measured 102,140 opaque pixels across fourteen scopes/eight crossings: 204 full-strength, zero
  fading, and 101,936 distance-neutral, plus 819,696 clear pixels. The counts sum exactly to the
  planner's 921,836 committed tile pixels.
- Authored fog remains useful for visually assessing AO/fog overlap, but it no longer changes the
  coverage categories. Particles and weather remain naturally colored over the coverage
  visualization, independently proving they are outside SAO.
- The production `RETAIL DIVERGENCE` marker cites `acclient.c:296701-296729`,
  `297381-297434`, and `441096`, states the enabled visual/order consequence, and includes the
  portal/fog census. After the visual, performance, and transition-motion gates passed, the feature
  became default-on while retaining an explicit user disable switch for retail presentation.
- Depth-derived normals pass the first-version quality bar. Matched sealed-interior portal captures
  have 3.32% normalized RMSE and add broad, stable grounding at the bed, doorway, and wall/ceiling
  contacts without silhouette halos. Hybrid indoor/outdoor captures have 2.76% normalized RMSE and
  no scope-transition seam. The close candle/emissive capture changes by 1.26%; the candle remains
  visually luminous. Opaque emissive attenuation remains an explicit v1 concession because no
  material-classification attachment exists.
- The 10-unit outdoor portal approach/return sweep shows no fade ring, atlas seam, or half-resolution
  phase jump. Start-to-return normalized RMSE is 0.000205 while the moved pose differs by 10.88%,
  proving the return comparison is sensitive. Retained evidence is
  `/tmp/holtburger-sao-motion-final.png.sweep-{start,end,returned}.png`.
- At 1920x1080 on the RX 7900 XT, three-run median SAO time is 0.128 ms flat (0.118, 0.128,
  0.130) and 0.250 ms portal (0.249, 0.250, 0.251), safely below the 2 ms budget. The ordinary
  scratch footprints remain 1,036,800 and 6,220,800 bytes respectively.
- Matched/focused evidence includes sealed interior, hybrid indoor/outdoor, outdoor-root portal,
  close emissive/particles, authored fog/weather, dynamic opaque entities, authored alpha-tested
  vegetation, transparent objects, and particles. The pre-existing broken synthetic instancing
  fixture remains recorded Phase 2 debt; authored DA55 content supplies the alpha-test/transparent
  acceptance evidence without broadening this feature into a batching repair.
- Cleanup dry-run retained the coverage/cycle/sweep harness controls and identified three required
  production cleanups: migrate flat and portal target owners to the shared allocation-binding
  guard, audit SAO program-construction and post-pass WebGL state, and remove the resulting private
  duplicate binding helpers/vocabulary. No second frame schedule or alternate portal executor path
  is accepted.

### Phase 5: Cleanup, Documentation, and Final Verification

#### Deliverables

- Remove temporary shader views, logs, probes, duplicate copy paths, and stale post-process
  terminology not used by the accepted design.
- Keep harness controls that provide durable SAO coverage/performance evidence.
- Update renderer/portal documentation to describe flat-scene ownership, optional scope-tile SAO,
  and depth preservation without recasting the renderer as a general render graph.
- Audit resource destruction, context-loss behavior, resize paths, texture-unit restoration, WebGL
  state restoration, and profiler teardown.
- Format, type-check, lint, test, and run the final browser/GPU matrix.

#### Acceptance Criteria

- No inactive shader variants, compatibility wrappers, duplicated target owners, or unconsumed
  diagnostics survive.
- SAO-disabled frames retain the one flat/portal schedule, allocate no SAO scratch
  resources, and perform no SAO draws.
- SAO-enabled frames allocate bounded, accurately reported scratch targets and release them when
  disabled or destroyed; the unconditional flat-scene target remains owned by the renderer.
- Every touched WebGL state has explicit ownership and restoration; subsequent object and particle
  draws do not depend on accidental post-process state.
- All TypeScript/Svelte checks, ESLint/Knip checks, focused tests, full frontend tests, and browser
  harness cases pass.
- Real-GPU before/after profiles and representative screenshots are recorded in this plan.

#### Task Checklist

- [x] Remove temporary diagnostics and collapse duplicate mechanisms.
- [x] Consolidate the portal-atlas, flat-scene, and SAO scratch allocation-binding guards into one
      renderer-local helper after enumerating the framebuffer/texture bindings each owner preserves.
- [x] Sweep deleted/renamed vocabulary across code, metrics, UI, tests, and docs.
- [x] Audit WebGL lifecycle/state and context-loss behavior.
- [x] Run `npm run format:check`, `npm run check`, `npm run lint`, and `npm run test:ts` from
      `apps/holtburger-3d`.
- [x] Run deterministic SwiftShader harness cases and the representative `--gpu` profile matrix.
- [x] Record final decisions, concessions, timings, target bytes, and remaining debt.

#### Decisions and Course Corrections

- Completed 2026-08-11.
- Flat, portal-atlas, and SAO scratch allocation now share
  `withPreservedWebGL2AllocationBindings`. The helper owns the exact state all three allocators
  mutate: draw/read framebuffer bindings, active texture unit and its 2D binding, and texture unit
  zero's 2D binding when it differs from the active unit. The three private binding snapshots and
  their duplicate vocabulary were deleted. Failed replacement allocation remains transactional and
  retains the previous target generation and caller bindings.
- The state audit found and removed one genuine leak: scratch initialization used global
  `clearColor`, which could contaminate a later view in the same frame. This implementation first
  replaced it with attachment-local `clearBufferfv`; the later particle/SAO cost-reduction plan
  proved exact scaled-tile coverage and removed scratch initialization entirely. SAO program
  construction is also transactional: partial programs, VAO, and metadata-buffer allocation are
  deleted on failure, and the caller's current program/generic uniform-buffer binding are restored. Successful draws leave
  the renderer's documented baseline, explicitly reset blend equation/function, depth state,
  color/depth masks, VAO, generic UBO binding, and binding point 1. Portal tile state is explicitly
  invalidated before weather resumes; flat presentation explicitly replaces the pass's program and
  texture state before deferred objects.
- Scratch ownership is lazy and bounded. The final full-resolution deterministic 1280x720
  on/off/on cycle reported 1,843,200 bytes/allocation 1/disposal 0, then zero bytes/allocation
  1/disposal 1, then 1,843,200
  bytes/allocation 2/disposal 1 without a content reload or flat-target reallocation. Destroy is
  idempotent, disables the live scratch generation, deletes immutable pass resources, and follows
  the renderer's existing whole-restart context-loss contract. Profiler queries and all renderer
  target owners are destroyed through the same renderer teardown.
- Documentation now names the unconditional flat `RGBA8`/D24 target, exact color/depth
  presentation, optional opaque-depth SAO boundary, portal tile ownership, and unchanged deferred
  ordering. The stale claim that flat mode performs no offscreen rendering was removed. No generic
  render-graph or post-process abstraction was introduced.
- `npm run check`, `npm run lint` (ESLint, Knip, and Clippy), and `npm run test:ts` are green; Vitest
  reports 150 files and 1,022 tests. Knip prompted removal of two policy exports that existed only
  for tests. Every changed file passes Prettier. Repository-wide `npm run format:check` still exits
  nonzero for 30 pre-existing, untouched files; the initial run named those same 30 plus the new SAO
  file, and the final run names only the baseline 30. Formatting unrelated files was rejected as
  out-of-scope churn, so the final formatting gate is explicitly change-scoped.
- Final SwiftShader flat disabled/enabled and hybrid portal disabled/enabled cases completed with no
  browser console messages. The hybrid portal retained six selected scopes, four crossings, four
  visible dynamic entities/nine parts, one deferred transparent draw, and four particle batches in
  both modes. Retained captures are `/tmp/holtburger-sao-final-{flat,portal}-{disabled,enabled}.png`.
- The initial half-resolution final RX 7900 XT 1920x1080 confirmation measured 0.050 ms ambient
  occlusion for flat mode and 0.362 ms for the six-scope hybrid portal view. Scratch bytes were
  1,036,800 and 6,220,800;
  renderer-owned scene/portal target bytes were 16,588,800 and 161,740,800 respectively. Both are
  far below the 2 ms gate and agree with the Phase 4 three-run stress medians. Retained captures are
  `/tmp/holtburger-sao-final-gpu-{flat,portal}.png`.
- Remaining debt is deliberately outside this feature: the pre-existing synthetic `instanced`
  fixture fails in generated transparent compaction, and the renderer has a latent multi-view
  diagnostics-semantics mismatch. Neither changes SAO scheduling or the accepted authored-content
  evidence. Opaque emissive attenuation and depth-derived normals remain recorded v1 concessions;
  the user disable switch restores retail presentation when requested.
- Post-completion review removed the feature's avoidable render-loop GC churn. Flat tile metadata
  now writes directly into the retained UBO staging array; flat and scratch owners accept scalar
  dimensions and allocate extent records only for a replacement generation; SAO consumes the
  existing camera plus projection; lifecycle metrics read scalar getters instead of allocating
  defensive target snapshots; the effective-fade metrics record is retained; and disabled/configured
  fade policy identities are shared. Ordinary profiling-off disabled frames now add no source-level
  per-frame allocation. Enabled frames retain one immutable policy record referencing the shared
  distance fade. Explorer's 4 Hz diagnostic
  snapshot still copies its nested AO record intentionally so callers cannot retain mutable renderer
  state; harness-only coverage readback remains deliberately allocation-heavy and outside
  production.
- Post-review portal motion exposed a subtle soft dark band moving through indoor/outdoor portal
  apertures as the camera distance changed. The same geometry was stable when it became the camera
  domain. Full-resolution scratch made the band and AO sharper but did not remove it, falsifying
  half-resolution tile quantization. Raw-evaluation and blur checkpoints proved the corruption
  already existed before filtering. The decisive clue was a blemish-free diagonal frontier that
  expanded from one aperture corner as the camera approached: every packed tile instance emitted
  the fullscreen oversized triangle `(0,0), (2,0), (0,2)` into one atlas-wide viewport, so its
  unclipped wings rasterized over neighboring tiles with the wrong flat tile ordinal. Replacing it
  with an exact six-vertex quad removed both the diagonal frontier and all bands in the user's live
  motion test. Evaluation also now rejects unavailable off-tile kernel samples instead of
  duplicating border depth. All temporary scope/stage visualizations were removed after proof.
  Full resolution remains retained for improved AO definition. At 1920x1080 on the RX 7900 XT, the
  earlier confirmation run measured
  0.078 ms and 4,147,200 scratch bytes in flat mode, and 0.738 ms and 24,883,200 bytes in the
  six-scope/four-crossing hybrid portal view. Both remain below the 2 ms gate. A 1280x720
  SwiftShader hybrid-portal smoke retained all six scopes and four crossings without console errors
  and reported the exact 11,059,200-byte full-atlas scratch footprint. The harness cannot sweep an
  EnvCell-resident camera without changing the domain under test, so removal of the user-observed
  moving band remains a live-motion acceptance check rather than a still-image claim.
- Explorer now exposes only appearance parameters that change through shader uniforms: strength,
  world-space radius, bias, and bilateral edge threshold. They travel as one validated
  `FrameSettings` composite and do not reallocate scratch targets. Full-strength/cutoff distances
  are read-only facts from renderer tuning. Resolution and sample count
  remain immutable quality settings because they change resource and performance contracts. The
  untouched flat harness default enabled AO with the 64-128-unit range and 1,843,200 active
  scratch bytes; the explicit-off harness reported a null effective range and zero active bytes.
  The default-on transition-portal smoke retained six scopes/four crossings, reported 11,059,200
  active scratch bytes, included four dynamic opaque draws plus the later particle batches, and
  emitted no browser console messages.

## Risks and Mitigations

| Risk                                                                                                 | Mitigation                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Depth-derived normals halo at silhouettes or thin geometry.                                          | Choose local derivatives across the smaller depth discontinuity, use depth-aware filtering, keep AO near-field and low-frequency, and gate acceptance on motion sweeps rather than still images alone.     |
| AO darkens already-fogged color.                                                                     | Accept the subtle bounded overlap for v1 and verify it under authored near fog; if it becomes material, preserve the fog contribution during composition rather than disabling nearby AO.                  |
| AO darkens emissive opaque materials because the forward scene color has no material classification. | Treat emissive attenuation as an explicit Phase 4 gate. Keep default disabled or resteer toward a proven classification attachment if the artifact is material; do not guess a material mask from color.   |
| Portal AO samples cross a scope tile or atlas packing gap.                                           | Consume planner-owned tile rectangles, rasterize exact per-tile quads, reject unavailable evaluation taps, clamp only the fixed blur footprint, and use boundary-heavy portal fixtures.                    |
| Per-scope portal AO work scales poorly with visible scope count.                                     | Attribute the complete AO phase, compare time against selected scope and tile-pixel metrics, and prefer batched tile draws over one independently synchronized pass per scope.                             |
| Flat presentation loses depth precision through its new color/depth copy.                            | Retain D24, write sampled depth explicitly, extend the existing projected-depth browser fixture, and verify deferred objects/particles against the flat target path.                                       |
| The unconditional flat target adds memory and presentation cost even with SAO disabled.              | Baseline target bytes and copy GPU time before SAO, use the existing RGBA8/D24 formats, and reject the cutover if representative real-GPU evidence makes the structural simplification an unjustified tax. |
| The flat-schedule collapse changes profiled and unprofiled behavior.                                 | Route both through nullable-profile helpers and assert identical submissions, counters, and screenshots with profiling toggled; profiling may differ only in clocks and GPU queries.                       |
| AO bands or leaks across portal-tile edges.                                                          | Use exact instanced tile quads, reject off-tile evaluation taps, and keep bilateral filtering tile-local. The live transition-domain motion test proved the former oversized-triangle overlap is removed.  |
| Fullscreen work exceeds its GPU budget despite distant early exits.                                  | Profile the AO phase independently on a real GPU; tune resolution/sample count from evidence. Early exits save sampling cost, not raster coverage.                                                         |
| Lazy target allocation leaks or churns during toggles/resizes.                                       | Follow transactional portal-target ownership, retain same extents, report generations/bytes, and test enable/disable/resize/destroy sequences.                                                             |
| Texture/program state contaminates later transparent passes.                                         | Make the pass restore or explicitly establish every state its next consumer needs; validate with transparent and particle fixtures rather than relying only on `getError`.                                 |
| The feature silently becomes a generic post-processing framework.                                    | Keep names and contracts SAO-specific. Introduce shared post-process infrastructure only after a second concrete consumer proves an isomorphic smaller abstraction.                                        |

## Definition of Done

- [x] Flat and portal rendering use the same opaque-depth SAO algorithm at their respective
      renderer-owned target boundaries.
- [x] Flat rendering has one unconditional scene-target/presentation path; no direct-to-default
      compatibility route remains.
- [x] Flat rendering has one nullable-profile phase schedule; profiling cannot change submitted
      scene work or ordering.
- [x] Depth-reconstructed full-resolution AO produces stable nearby contact shading; the exact
      user-observed transition-portal motion path is band-free after exact tile rasterization.
- [x] AO smoothly fades out across its fixed renderer-owned near-field range.
- [x] Terrain plus static and dynamic opaque/alpha-tested objects cast and receive AO.
- [x] Sky, weather, far-field geometry, transparent objects, particles, and disabled mode preserve
      their expected output and ordering.
- [x] Portal scope selection, composition, envelope behavior, and depth remain correct.
- [x] Resource allocation, byte accounting, resize, disable, destroy, and context-loss behavior are
      explicit and tested.
- [x] Explorer control and renderer diagnostics expose only actionable policy and evidence.
- [x] The retail divergence marker contains a decompile citation, visible consequence, and coverage
      census.
- [x] Deterministic visual cases and real-GPU profiles satisfy the recorded quality/performance
      gates, including the user-confirmed transition-portal motion case.
- [x] Changed-file formatting, type checking, linting, unit tests, browser harness, and GPU harness
      are green; the unrelated repository-wide Prettier baseline is recorded above.
- [x] The plan records final decisions, concessions, measurements, and remaining debt.

## Resolved Questions

- The retained first-version defaults are a 1.0 resolution scale, 12-sample deterministic kernel,
  2-unit radius, 0.05 bias, 1.5 intensity, 0.75 bilateral threshold, and configured 64-128-unit
  distance fade. Explorer can tune radius, bias, intensity, and the bilateral threshold.
  Resolution, sample count, and distance eligibility remain renderer-owned quality policy;
  authored fog does not reshape or disable the fade.
- The 2 ms 1920x1080 budget holds on the RX 7900 XT. Initial half-resolution Phase 4 stress medians
  were 0.128 ms flat and 0.250 ms portal; retained full-resolution confirmation measured 0.078 ms
  flat and 0.738 ms in the six-scope hybrid portal view.
- Emissive attenuation is acceptable for v1 and does not justify a material-classification
  attachment. It remains an explicit concession with a user disable switch.
- Depth-derived normals meet the still and motion quality bar. The indoor/outdoor transition band
  was packed-tile raster overlap rather than a normal-reconstruction or precision defect, so a
  normal attachment remains unnecessary for v1.
- SAO defaults on after passing the recorded quality/performance gates. It remains user-switchable
  because it is a deliberate retail presentation divergence.
