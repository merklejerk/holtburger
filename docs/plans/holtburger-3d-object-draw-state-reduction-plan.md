# Holtburger 3D Object Draw and State Reduction Plan

## Goal

Cut the CPU cost of object submission on the `0xda55ffff` outdoor reference scene by removing
per-draw uniform uploads that carry no new information, then reducing the number of baked material
ranges the frame submits at all.

**Target: 300 fps is the floor, 500 fps is the goal.** 500 fps is a 2.0 ms frame, and the GPU's
observed 3-15% utilization says the hardware is nowhere near the constraint.

Raising the bar from 300 to 500 changes what this plan must cover, and the arithmetic belongs up
front rather than in Phase 4. Non-opaque CPU outdoors is roughly 1.14 ms —
`sceneContributionResolutionMs` 0.352, `sceneQueryMs` 0.327, `instanceRunPreparationMs` 0.227,
`blendedOrderingMs` 0.135, `terrainSubmissionMs` 0.097. Against a 3.33 ms frame that is comfortable
overhead. Against 2.0 ms it is **57% of the entire budget**, and driving `opaqueSubmissionMs` to zero
would still leave the scene short of 500 fps. Scene query and contribution resolution are therefore
deferred rather than dismissed; Phase 4 decides whether they get a phase here or their own plan.

This is the object-path sibling of
[the terrain draw and state reduction plan](holtburger-3d-terrain-draw-state-reduction-plan.md),
whose Phase 1 is the direct precedent for this plan's Phase 1.

## Two Reference Scenes, Two Different Problems

Outdoor and indoor scenes have almost nothing in common, and an outdoor-only investigation draws
wrong conclusions about the client as a whole. Both are recorded here; **this plan addresses the
outdoor one.**

All figures rebaselined on `0f5bedb1` (dungeon-aware scene interest) via
`npm run harness:browser -- --gpu --profile-renderer` at 1600x948 on
`ANGLE (AMD, Vulkan 1.4.354 (AMD Radeon RX 7900 XT (RADV NAVI31)), radv)` — real adapter, not
SwiftShader. The interest-policy change left **every draw count in both scenes identical**; only
`objectTextureBinds` moved, and only downward.

### Outdoor: `0xda55ffff`, radius 8 — binding-bound

`timing.averageFrameWorkMs` **4.132 ms** over 1,181 frames. `tickProfile.mean` totals 3.900 ms of
which `render` is 3.757; everything else — script, particle, animation, presentation publish — sums
to 0.143 ms, **3.7% of the tick**. There is no frame-prep problem here.

| CPU 60-frame mean (3.747 ms)    | ms        | GPU single frame (3.243 ms) | ms        |
| ------------------------------- | --------- | --------------------------- | --------- |
| `opaqueSubmissionMs`            | **2.370** | `opaqueMs`                  | **2.803** |
| `sceneContributionResolutionMs` | 0.352     | `ambientOcclusionMs`        | 0.257     |
| `sceneQueryMs`                  | 0.327     | `nearTerrainMs`             | 0.096     |
| `instanceRunPreparationMs`      | 0.227     | `presentationMs`            | 0.038     |
| `blendedOrderingMs`             | 0.135     | `blendedMs`                 | 0.033     |
| `terrainSubmissionMs`           | 0.097     | `particleMs`                | 0.017     |

CPU and GPU near-balanced, both dominated by opaque submission — the signature of draw-call and
state overhead, not shading. `amdgpu_top` showed a sustained 3-15% while the Explorer ran.

Draw composition, unchanged by the policy commit: `submittedStaticObjectDrawCount` 1,835 (of which
`submittedBakedStaticObjectDrawCount` 1,823), EnvCell shell 629 + resident 642, transparent 34 (from
893 candidates via 19 runs), dynamic 33 (from 190 parts), particle 55 — roughly **3,228 draws**.
`visibleStaticLayerCount` 309, `objectProgramChanges` 14, `objectTextureBinds` 605 (was 635).

Pass ordering is healthy: 14 program changes across 3,228 draws means passes are not re-entered per
landblock. Instancing is healthy where it applies — transparency collapses 893 candidates to 34
draws, dynamics 190 parts to 33.

V8 self-time, 32,602 samples over 5 s: `uniformMatrix4fv` 9.74%, `#drawObjectRange` 9.42%,
`uniform4f` 9.29%, `uniform1i` 7.91%, `drawElements` 5.44%, `uniform1f` 4.51%,
`#frustumIntersectsLandblockBounds` 4.43%, `#drawOpaqueObjects` 4.42%, `uniform3f` 2.80%,
`#selectEntries` 2.78%, `formGroupedObjectInstanceRuns` 2.00%, `formAdjacentObjectInstanceRuns`
1.84%.

**The `uniform*` family is 35.5%** (35.52% measured; 37.9% pre-rebaseline). GC does not reach the
top twelve, so this is not allocation pressure.

### Indoor: `0x0007014e`, portal mode — portal-bound

`timing.averageFrameWorkMs` **1.425 ms** over 3,283 frames — the indoor scene is _faster_ than the
outdoor one in Chrome, around 700 fps. `tickProfile.mean` totals 1.387 ms.

Draw composition, unchanged by the policy commit: baked static 237, EnvCell shell 122 + resident
115, transparent 28, dynamic 26, particle 10 — roughly **538 draws**. `visibleStaticLayerCount` 83,
`objectProgramChanges` 10, `objectTextureBinds` 40 (was 101 — the drop is real, from outdoor
textures no longer being resident).

Portal work dominates: `portalSelectedScopeCount` 58, `portalSelectedCrossingCount` 36,
`portalCompletedCullDepth` 16, `portalProjectionPrimitiveCount` ~29,000, `portalFramebufferCount` 4,
`portalAtlasTilePixelCount` 2,616,577 against a 1,516,800-pixel drawing buffer — the atlas
rasterizes **1.7x the screen**.

GPU single frame totals 1.850 ms: `opaqueMs` 0.875, `portalCompositionMs` 0.578,
`ambientOcclusionMs` 0.350. A pre-rebaseline capture of the identical workload reported `opaqueMs`
0.096 — see Measurement Constraints on single-frame GPU sampling before treating either as a budget.
The stable claim is the shape, not the number: object draws are a small share of indoor cost, and
portal composition plus ambient occlusion are large ones.

The 60-frame CPU window is not usable for this scene at present — see Measurement Constraints. Its
pre-rebaseline composition was `portalPlanningMs` 0.422, `opaqueSubmissionMs` 0.373,
`sceneContributionResolutionMs` 0.070; the post-rebaseline window caught a hitch (p95 6.4 ms) and
reported `blendedSubmissionMs` 0.512 against 0.035 for the same 28 transparent draws. Phase 0 must
fix the sampling before indoor phase attribution is quotable.

Indoor V8 self-time is a different shape entirely: `particle-system` 14.8% (`advance` 7.93,
`collectDrawRanges` 4.19, `envelopeRadiusFor` 2.72), `portal-window-arena` 12.8%
(`clipHomogeneousPolygon` 4.35, `normalizePolygon` 3.43, `clipNdcPolygon` 1.84, `#projectAperture`
1.66, `apertureIntersectsNearClip` 1.47), `uniform*` 12.9%, `texSubImage2D` 2.63%.

Indoors the cost is **JS compute** — polygon clipping and particle simulation — not WebGL binding
calls.

## The Mechanism This Plan Attacks

`#drawObjectRange` (`webgl2-renderer.ts:3275`) issues, unconditionally, per draw: `uniformMatrix4fv`
localToLandblock, `uniform3f` landblockOffset, `uniform1i` wrapRepeat, `uniform1i` palettedClipMap,
`uniform1f` alphaTest, `uniform1i` materialKind, `uniform4f` materialColor, `uniform4f` baseRect,
`uniform4f` paletteRect, `uniform4f` detailRect, `uniform1f` detailTiling, `uniform1i` useDetail,
`uniform1f` luminosity — 9 to 13 calls depending on material and detail.

At ~3,200 outdoor draws that is roughly 30,000 uniform calls per frame. Cross-check: 35.5% of
3.747 ms is ~1.33 ms; over 30,000 calls that is ~44 ns each, the correct cost for a V8 WebGL
binding. Nothing is anomalously slow — the call count is the defect.

None of these route through `WebGL2ObjectStateApplicator` (`webgl2-object-state-applicator.ts`),
which already performs exactly this redundancy filtering for `applyProgram`, `applyCullFace`,
`applyBlend`, `applyTextureUnit`, and `applyVertexArray`, and whose effectiveness is visible in the
14 program changes and 605 texture binds. The uniforms call `gl.uniform*` directly and bypass it.

### What "baked" means here

`prepareBakedStaticObjectGeometry` (`static-object-geometry-worker.ts:154`) performs real geometry
merging: every contribution is transformed by `part.sourceToLandblock` into landblock space, grouped
by material binding, and concatenated into one shared buffer, emitting `BakedStaticObjectRange[]`
(`:49`) as index ranges. So 1,823 baked draws are **not** 1,823 objects — they are 1,823
material-binding ranges across 309 merged layers, averaging 5.9 ranges per layer and 272 triangles
per draw.

The name is a hazard nonetheless: `transformSource: "baked"` means only that the transform arrives
as `uniform mat4 uLocalToLandblock` (`webgl2-object-program.ts:50`) rather than as an instance
attribute. It says nothing about geometry merging, and it collides with `aBakedLight`. Phase 5
renames it.

## Measurement Constraints

- **`frameProfile.cpu.mean` is a 60-frame window and is not a reliable magnitude.**
  `RuntimeTickProfiler`'s `WINDOW_SIZE` is 60, which is one second at 60 fps but only ~26 ms of wall
  time when the harness runs uncapped at ~2,300 fps. Two runs of the identical dungeon workload
  disagreed in _sign_: the 60-frame window said **+21.9% slower** while
  `timing.averageFrameWorkMs` over 3,283 frames said **-9.2% faster**. Use
  `timing.averageFrameWorkMs` for magnitude and treat `frameProfile.cpu.mean` as _composition only_,
  corroborated across runs. Phase 0 widens or repeats the window before any phase delta is claimed.
- **`frameProfile.gpu` is a single frame**, not a mean — it carries a `frameNumber`. Two captures of
  the identical indoor workload reported `opaqueMs` 0.096 and 0.875. Never quote a single GPU figure
  as a budget.
- **Timing varies run to run at identical draw counts.** Outdoor `averageFrameWorkMs` moved 4.223 to
  4.132 (-2.2%) with every draw count byte-identical. Any Phase 1 win smaller than roughly 5% needs
  repeated runs to be believed.
- **Resolved by the CEF cutover.** The three constraints below described the wry/WebKitGTK runtime
  the Explorer used until `tauri::Cef` replaced it. They are retained because every measurement
  recorded above them was taken under those conditions, and none of them apply to captures taken
  after the cutover: the Explorer now reports full-precision `performance.now`, a truthful
  `ANGLE (AMD, AMD Radeon RX 7900 XT (radeonsi navi31 ACO), OpenGL 4.6)`, and working GPU timing.
- ~~**WebKitGTK quantizes `performance.now()` to 1 ms.**~~ Explorer snapshots report `frameMs` as exact
  integers plus float residue (`updateFrameMs: 5.000000000003638`), the fingerprint of subtracting
  two quantized reads. Single-frame phase numbers are noise under WebKitGTK.
- ~~**`WEBGL_debug_renderer_info` is fabricated under WebKitGTK**~~, reporting `Apple GPU` / `Apple Inc.`
  on Linux/x86_64 as fingerprinting resistance, with `renderer`/`vendor` scrubbed to
  `WebKit WebGL` / `WebKit`. Driver identity must come from outside the page.
- **Hardware acceleration is confirmed.** `LIBGL_ALWAYS_SOFTWARE=1` made the Explorer much worse and
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` also made it worse, so radeonsi is live and the dmabuf
  zero-copy path is working. There is no configuration fix available.
- **The dungeon capture must target the cell, not the landblock.** Since `0f5bedb1`,
  `--landblock 0x0007ffff` fails with `Timed out awaiting EnvCell publication`: the harness always
  calls `waitForRequiredEnvCellPublication`, and a dungeon-only owner reached as an automatic
  landblock target yields no EnvCell demand. Passing the cell (`--landblock 0x0007014e`) makes
  `parseResidenceInput` build an explicit env-cell residence, which resolves to the dungeon branch.
  Verified: `sceneInterest` reports `activeDungeon` 1, `retainedOutdoor` 0, `effective` 1 even with
  `--terrain-radius 8`.
- **`sceneInterest` and `profiles` now reach harness JSON** (`briefHarnessReport`, since `0f5bedb1`),
  so resolved demand is observable rather than inferred.
- **`selectedRenderDomainCount` never reaches harness JSON.** Only `portalSelectedScopeCount` is
  plumbed (`webgl2-renderer.ts:1120`).
- **Flat mode is debug-only.** A flat-mode dungeon capture reported `objectProgramChanges` 193; the
  same vantage in portal mode reports 10. Flat-mode numbers are not budgets.
- **Explorer report schema is version 5** since `0f5bedb1`. Snapshots quoted during the original
  investigation were version 4.

## Runtime: CEF replaced wry/WebKitGTK

Measured after Phase 2, at the same outdoor vantage, with the renderer frame profiler:

| runtime                       | `cpu.mean.totalMs` |         |
| ----------------------------- | ------------------ | ------- |
| wry / WebKitGTK               | 4.412 ms           | 227 fps |
| CEF (`tauri::Cef`)            | **1.964 ms**       | 509 fps |
| Chrome harness, for reference | 1.881 ms           | 532 fps |

**2.25x raw**, and within 4.4% of real Chrome. The CEF capture ran a slightly lighter workload —
7.5% fewer object draws and a 15.6% smaller drawing buffer, because the pose was matched by eye —
so the engine-attributable share is closer to 2.0-2.1x. Either figure dwarfs what remained on the
table in this plan.

The per-phase split confirms the cause rather than coincidence: the phases that are pure JS compute
moved most (`particleSubmission` 5.17x, `terrainSubmission` 3.67x, `instanceUpload` 3.03x), while
`portalPlanning`, which is dominated by allocation and polygon state, moved least at 1.30x.

Three secondary effects matter more than the framerate for future work:

- `performance.now` is no longer quantized, so single-frame Explorer numbers are trustworthy.
- `EXT_disjoint_timer_query_webgl2` is exposed, so the Explorer reports GPU timing for the first
  time. Every GPU figure recorded earlier in this plan was Chrome-harness-only out of necessity.
- `WEBGL_debug_renderer_info` is truthful, so driver identity no longer has to come from outside
  the page.

### Distribution size

Chromium is Chromium, and the runtime swap does not avoid its footprint. Recorded because the
opposite was assumed earlier in this work, when Electron's bundle was treated as a cost CEF avoided.

CEF's Linux `minimal` archive is a Release build whose `libcef.so` nonetheless ships with DWARF
attached: 1.15 GB of debug sections inside 1.4 GB. `strip --strip-unneeded` leaves 248.9 MB with all
240 `cef_*` dynamic symbols intact, verified by running the Explorer against the stripped library.
The full shippable payload is then **361 MB**: `libcef.so` 249, `locales/` 47.7 across 220 files,
`libGLESv2.so` 19.1, `resources.pak` 15.4, `libvk_swiftshader.so` 15.1, `icudtl.dat` 10.4, rest 4.7.

**That is larger than Electron, not smaller.** Electron packages around 150-220 MB on Linux because
it ships a distribution-tuned Chromium. Bundle size is not an argument for CEF over Electron; the
arguments are that Rust stays in-process, there is no Node layer, no sidecar to supervise, and the
35 commands are untouched.

Trimming `locales/` to the shipped languages recovers ~47 MB, and dropping `libvk_swiftshader.so`
another 15 MB at the cost of the software rasterizer fallback, for a realistic floor near 300 MB.

The problem is Linux-specific. From CEF's build index for 150.0.10 minimal: linux64 300.4 MB,
windows64 156.6 MB, macosx64 124.6 MB, macosarm64 118.7 MB. Windows keeps debug info in separate
`.pdb` files and macOS in `.dSYM` bundles, so those distributions are already lean and need no
stripping. The macOS helper-bundle and signing path is unverified.

**This reframes what remains.** At 1.96 ms CPU against 0.79 ms GPU the outdoor scene is CPU-bound at
roughly 500 fps, so the plan's 500 fps goal is met without Phase 3. `opaqueSubmissionMs` is still the
largest single phase at 0.512 ms, so Phase 3 remains the correct next optimization — but it is now
elective rather than required.

## Out of Scope

- **The indoor portal path.** Portal planning (0.422 ms CPU), portal composition (0.581 ms GPU),
  ambient occlusion (0.356 ms GPU), and particle simulation (14.8% of indoor CPU samples) are the
  indoor bottleneck. They are a different problem with a different fix and deserve their own plan.
  Recorded above so that plan starts from evidence rather than a fresh investigation.
- **Migrating off Tauri/WebKitGTK — parked, not closed.** See below.
- **The terrain pass.** Owned by its own plan; `terrainSubmissionMs` is 0.108 ms outdoors.
- **Scene query and culling.** Deferred per the Goal's arithmetic; expected to become dominant.
- **Transparent ordering semantics.** Near-exact-sort and far-stable-grouping guarantees are
  preserved bit-for-bit. Batching must never absorb a range whose draw order is observable.
- **The instanced path's landblock partition.** `isCompatible` (`webgl2-renderer.ts:3208`) and
  `opaqueObjectInstanceBatchKey` (`:3637`) both key on `landblockId`, preventing instance runs from
  spanning landblocks. Real, but it constrains only 12 static draws plus already-collapsed
  transparency and dynamics.
- **Terrain streaming backlog.** The outdoor capture recorded `terrainWorker`: `workerCount` 1,
  `completedJobCount` 289, `peakQueuedJobCount` 75, `totalExecutionDurationMs` 676,
  `totalQueueDelayMs` 4,644 — roughly 7x longer queued than executing, ~175 ms for the tail job at
  peak depth. Note that 289 jobs is exactly 17x17, the full radius-8 neighborhood, so this measures
  **cold start, not flight**; in-flight behavior is unmeasured and `--follow-flight` is the tool for
  it. A dedicated streaming performance effort is planned separately.

### The engine question, parked

This work began as "is WebKitGTK's JavaScriptCore costing us frames, and should we move to
Electron?" The outdoor scene said no: frame prep is 0.164 ms and 43% of CPU is inside WebGL binding
calls whose count is an architecture property. That verdict was declared too early — the outdoor
scene is binding-bound and is therefore the _worst_ available discriminator for an engine question.

Indoors the picture differs sharply. Chrome renders the reference vantage at 1.535 ms; Explorer
snapshots from the same cell report `frameMs` of 4, 5, and 6 across three captures. That is roughly
**2.5-4x**, against ~1.2x outdoors, on a scene whose cost is JS compute — exactly where JSC and V8
diverge most.

That is suggestive, not conclusive: the WebKitGTK figures are single frames off a 1 ms clock.
Settling it needs a **profiling-enabled** Explorer capture at that vantage so `frameProfile.cpu.mean`
can be compared phase-by-phase against the Chrome table above. Three attempts produced
`profilingEnabled: false`, which Phase 5's toggle fix is intended to unblock.

The decision is independent of this plan's work: it changes which runtime ships, not which code is
wrong. If a residual gap matters later, the port surface is small — 16 files import `@tauri-apps`,
35 commands exist, and `dev_landblock_content_host.rs` already serves 28 of them over HTTP.

## North Stars

1. Per-draw cost should scale with what actually changes between draws, not with the number of
   draws. A uniform re-sent to the same value is a defect, not an optimization opportunity.
2. Reuse `WebGL2ObjectStateApplicator`. It is the established home for GL redundancy filtering and
   it demonstrably works. A parallel caching mechanism beside it would be the wrong shape.
3. All GL state of a given kind goes through the applicator, or none of it does. A cache that some
   call sites bypass is worse than no cache, because it desyncs silently and renders wrong.
4. Measure before believing, and measure the scene you are claiming about. Outdoor evidence
   repeatedly produced confident wrong conclusions about the indoor path.
5. Prefer deleting a per-draw upload over making it cheaper.
6. A diagnostic that can fail silently will eventually cost more than the thing it measures.

## Phase 0: Baseline and Instrumentation

**Deliverables**

- An `objectUniformUploads` counter and `objectDrawCalls` on the frame selection metrics, mirroring
  `terrainPerLandblockGlCalls` from the terrain plan. Must appear on the _public_
  `FrameSelectionMetrics`, not only the internal mutable one — the terrain plan found that the
  snapshot's object spread skips excess-property checking and lets internal-only fields reach
  harness JSON untyped.
- **Fix the profiling sample window before anything else.** `frameProfile.cpu.mean` averages 60
  frames, which is ~26 ms of wall time in an uncapped harness run and demonstrably disagrees in sign
  with the long-window average. Either widen the window, expose a mean over the whole measurement
  window beside it, or have the harness aggregate repeated captures. Until this lands, no phase
  delta in this plan is quotable, and Phase 1 has no way to prove it worked.
- A one-off census (harness-only, removed in Phase 5) recording, per draw, how many of the 9-13
  uniforms differ from the previous draw's value. This sizes Phase 1's ceiling before it is built.
- Answer: **is `localToLandblock` identity for baked static ranges?** Baked vertices are already in
  landblock space, yet `#drawObjectRange` uploads `object.localToLandblock` from
  `node.placement.localToLandblock` (`webgl2-renderer.ts:1826`, `:1850`) every draw. If it is
  identity for this population, that `uniformMatrix4fv` — 7.75% of outdoor CPU — is deleted, not
  cached.
- Answer: **do EnvCell shell and resident draws route through `#drawObjectRange`?** They are metered
  separately but are expected to reach the same path via `#drawOpaqueObjects` and
  `#drawBlendedObjects`. If so, Phase 1 covers all ~3,228 outdoor draws rather than the 1,823
  statics.
- Resident geometry bytes for the outdoor reference scene, so Phase 3's memory claim is confirmed
  against a real number rather than assumed.
- A baseline screenshot pair from two runs of the _same_ build, to establish this scene's
  run-to-run noise floor. The terrain plan measured 300-400 differing pixels of 810,240 at up to
  channel delta 40; "pixel-identical" is not an available acceptance criterion.
- A **timing** noise floor to match: three runs of the same build per scene, reporting the spread in
  `timing.averageFrameWorkMs`. Outdoor moved 2.2% between two runs at byte-identical draw counts, so
  the floor is not zero and Phase 1's win must clear it.

Note that `0f5bedb1` already delivers part of what this phase was going to add: `sceneInterest` and
`profiles` now reach harness JSON, so resolved demand no longer has to be inferred.

**Acceptance**

- Harness JSON reports uniform upload and draw counts for the outdoor reference scene.
- The census reports a redundancy percentage per uniform.
- Both open questions above are answered from data.
- A documented pixel-delta noise floor.

### Result: complete

**The sampling fix landed first, and it was load-bearing.** `RendererCpuFrameProfileWindow.mean` now
accumulates since an explicit reset instead of over a 60-frame tail; `WebGL2FrameProfiler.reset()` is
exposed through `RendererFrameDiagnostics.resetProfile` and called from the harness's `resetTiming`,
so one reset delimits both aggregates and a `--measure-ms` window governs the renderer profile too.
The retained tail survives only for the percentile, which cannot be derived from running sums and is
now honestly named `p95RecentTotalMs` against
`FRONTEND_TUNING.diagnostics.percentileCpuFrameTail`.

`cpu.mean` now spans the whole measurement window (1,150-3,271 frames instead of 60) and tracks
`timing.averageFrameWorkMs` closely, the residual gap being the non-render part of frame work.

**Timing noise floor**, three runs per scene on `0f5bedb1`:

| scene   | `averageFrameWorkMs` median | spread | `cpu.mean.totalMs` median | spread |
| ------- | --------------------------- | ------ | ------------------------- | ------ |
| outdoor | 4.222 ms                    | 0.89%  | 4.061 ms                  | 0.87%  |
| dungeon | 1.447 ms                    | 3.30%  | 1.419 ms                  | 3.36%  |

Compare the pre-fix behaviour this replaces: the 60-frame window reported **+21.9%** on the dungeon
where the long window reported **-9.2%**. Phase 1 must clear roughly 1% outdoors and 3.5% indoors to
be believed.

**Uniform census.** Counted at the upload site via new `applyUniform*` methods on
`WebGL2ObjectStateApplicator`, which compare against the last applied value per
`WebGLUniformLocation` and **still upload unconditionally**. Rendering is therefore unchanged and
Phase 1 is the one-line-per-method change to act on the flag — the census is the mechanism, not
scaffolding to remove.

| scene   | `objectDrawCalls` | `objectUniformUploads` | per draw | redundant      | identity transforms |
| ------- | ----------------- | ---------------------- | -------- | -------------- | ------------------- |
| outdoor | 1,868             | 20,914                 | 11.20    | 17,335 (82.9%) | 1,194 (63.9%)       |
| dungeon | 263               | 2,850                  | 10.84    | 2,385 (83.7%)  | 115 (43.7%)         |

**Phase 1's ceiling is ~83% of uniform traffic.** Against `uniform*` at 35.5% of outdoor CPU samples
that is roughly 29% of outdoor CPU, before accounting for the comparison cost that replaces it.

**`localToLandblock` is identity for a majority of baked draws but not all** — 63.9% outdoors, 43.7%
indoors. The non-identity remainder is EnvCell shells, whose geometry is authored in structure-local
space and carries a real `structureToLandblock`. So the `uniformMatrix4fv` cannot simply be deleted;
it is a cache hit for most draws and a genuine upload for the rest, which the redundancy filter
already handles without a special case.

**EnvCell draws do share `#drawObjectRange`**, confirmed both by construction
(`#compileShellNodeSubmissions` builds `drawKind: "baked"` submissions through
`#compileStaticSubmission`) and by arithmetic: `objectDrawCalls` equals
`submittedStaticObjectDrawCount + submittedDynamicDrawCount` exactly, in both scenes.

**Correction: the `submitted*` counters overlap, and this plan previously double-counted them.**
`submittedEnvCellShellDrawCount` and `submittedEnvCellResidentDrawCount` are _subsets_ of
`submittedStaticObjectDrawCount`, which counts every non-dynamic draw
(`webgl2-renderer.ts:3476-3488`). The outdoor scene issues **1,868** object draw calls, not the
~3,228 stated earlier. `objectDrawCalls` now measures actual `#drawObjectRange` invocations with no
overlap, and is the figure to use.

**Resident geometry payload**, outdoor reference scene: **84.52 MiB** across 1,531 resources
(`geometryResourceBytes`, new on `StaticObjectRuntimeDiagnostics`). This is the baseline Phase 3's
"re-partitioning, not duplication" claim is judged against.

**Screenshot noise floor** — two runs of the same build, `--particle-seed 7`, 1600x861 captured:
**4,703 of 1,377,600 pixels differ (0.34%), max channel delta 148.** That is far noisier than the
terrain plan's 300-400 pixels at delta 40, and it is high enough that screenshot comparison is weak
evidence for this scene. Phase 1 should either isolate the source (particles are the first suspect
despite the seed) or lean on the census counters and timing rather than pixels.

## Phase 1: Route Object Uniforms Through the State Applicator

Independent of everything after it, and the largest win per line changed. Helps both scenes —
`uniform*` is 35.5% of outdoor CPU samples and 12.9% of indoor.

**Deliverables**

- Extend `WebGL2ObjectStateApplicator` with last-value uniform filtering keyed by
  `WebGLUniformLocation`. Locations are per-program objects and GL retains uniform state per program
  across program switches, so the cache keys on location and must **not** reset on program change.
- Route every `gl.uniform*` in `#drawObjectRange` through it.
- Audit and either route or deliberately exempt every other object-pass uniform writer:
  `#activateObjectProgram`, `#applyObjectLighting`, and
  `WebGL2PortalScopeAtlasPipeline.routeObjectSubmission`. Per north star 3, one bypassing writer
  desyncs the cache invisibly.
- Delete the `#lastDrawnLandblockOffset` hand-rolled cache (`webgl2-renderer.ts:3298-3313`), which
  caches the Map lookup and then uploads unconditionally anyway. The applicator subsumes it.
- If Phase 0 shows `localToLandblock` is identity for baked ranges, drop the upload for that
  population rather than caching it.

**Acceptance**

- `objectUniformUploads` drops by the percentage Phase 0's census predicted, within a stated margin.
- Screenshots pixel-equivalent to baseline within Phase 0's noise floor.
- A unit test proves the applicator re-uploads after a value changes, skips when it does not, and
  does not falsely invalidate retained per-program state across a program switch.
- `timing.averageFrameWorkMs` re-measured against baseline for **both** reference scenes, across at
  least three runs each, with the win stated against Phase 0's timing noise floor.
  `frameProfile.cpu.mean` may be cited for composition but never as the magnitude.

### Result: complete

**Audit outcome — the cache is sound because every location has exactly one writer.**
`#drawObjectRange` owns thirteen locations (`localToLandblock`, `landblockOffset`, `wrapRepeat`,
`palettedClipMap`, `alphaTest`, `materialKind`, `materialColor`, `baseRect`, `paletteRect`,
`detailRect`, `detailTiling`, `useDetail`, `luminosity`). Every other writer on an object program is
disjoint: `#activateObjectProgram` writes `clipTransform`/`projection`/`view`/dynamic lights/fog,
`#applyObjectLighting` writes the sun, ambient and static-light uniforms, and the portal pipeline
writes only `clipTransform`. `#beginTerrainGroup` also writes a `localToLandblock`, but on the
terrain program, whose locations are distinct objects. No routing of the other writers was needed;
the invariant is per-location, and it is now stated in the applicator's doc comment so a second
writer cannot be added silently.

**Also landed:** `#lastDrawnLandblockId`/`#lastDrawnLandblockOffset` deleted. It cached the offset
lookup and then uploaded unconditionally anyway; the applicator now suppresses the upload and the
map lookup is cheap enough not to justify a second cache with its own invalidation.
`objectRedundantUniformUploads` became `objectSuppressedUniformUploads`, since after this phase those
writes are not uploads at all.

**Result, medians of three runs.** The honest baseline is the clean pre-instrumentation build at
`0f5bedb1`, not Phase 0's census build — the counting-only applicator compared every uniform _and_
uploaded it, costing about 2% on top.

| scene   | clean `0f5bedb1` | Phase 0 census | Phase 1   | change vs clean | noise floor |
| ------- | ---------------- | -------------- | --------- | --------------- | ----------- |
| outdoor | 4.132 ms         | 4.222 ms       | **2.469** | **-40.2%**      | 1.94%       |
| dungeon | 1.425 ms         | 1.447 ms       | **1.281** | **-10.1%**      | 6.77%       |

Outdoor is 405 fps uncapped, twenty times the noise floor. Uniform traffic behaved exactly as the
census predicted:

| scene   | draws | GL uniform calls    | per draw      | suppressed |
| ------- | ----- | ------------------- | ------------- | ---------- |
| outdoor | 1,868 | 20,914 -> **3,579** | 11.20 -> 1.92 | 17,335     |
| dungeon | 263   | 2,850 -> **465**    | 10.84 -> 1.77 | 2,385      |

**V8 corroboration, outdoor:** the `uniform*` family fell from **35.52% to 4.84%** of self-time.
The comparison that replaced it, `#recordUniform`, costs **12.35%** — so the trade is roughly 31
points of GL binding for 12 points of JS comparison, which is why the win is large but not the full
83%. `drawElements` also fell, 5.55% to 2.64%.

**The GPU moved too, unexpectedly.** Outdoor `opaqueMs` went from 2.803 ms to 1.05-1.95 ms across
single-frame samples, despite Phase 1 changing no GPU work. The plausible mechanism is that ANGLE
defers state application to draw time, so removing redundant uniform sets removes dirty-state
flushes as well as binding calls. Not proven, and single-frame GPU samples are weak evidence; noted
rather than claimed.

**Two anomalies recorded rather than explained.**

1. _The dungeon's opaque and blended buckets swapped._ `blendedSubmissionMs` fell 0.522 -> 0.025
   while `opaqueSubmissionMs` rose 0.268 -> 0.642, nearly cancelling, and consistently across all
   three runs rather than as noise. Total fell, which is what matters, but the split moved in a way
   the change does not obviously explain. AGENTS.md warns that these buckets misattribute work
   crossing their boundaries; treat the dungeon's per-phase attribution as unreliable until someone
   isolates it.
2. _The dungeon V8 before/after is not a valid A/B_ and was discarded. Its "before" profile was
   captured on `2273d861` targeting `0x0007ffff`, so it crosses both a commit and an
   interest-resolution change. What can be said from this build's own metrics: only 465 uniform GL
   calls per frame now originate in `#drawObjectRange`, which cannot account for `uniformMatrix4fv`
   at 12.92% of dungeon self-time — so the dungeon's remaining uniform traffic is pass and portal
   level, which this phase does not touch.

## Phase 2: Re-measure and Resteer

**Deliverables**

- Full harness capture and V8 CPU profile for both scenes, tabulated against Phase 0.
- An explicit go/no-go on Phase 3. If Phase 1 lands the outdoor scene under ~3.0 ms CPU and the GPU
  is no longer the binding constraint, Phase 3's cost may exceed its value and this plan should stop
  early rather than spend it.
- Dry-run Phase 3 against the code as it then stands.

**Acceptance**

- A written go/no-go with the numbers behind it.

### Result: complete — **go on Phase 3, outdoor only**

Outdoor now renders at **2.469 ms / 405 fps**, so the **300 fps floor is met** and the 500 fps goal
needs a further 0.47 ms. CPU (2.358 ms) and GPU (1.5-2.4 ms) are close to balanced again, so neither
side alone is the constraint.

`opaqueSubmissionMs` is still **1.212 ms, 51% of outdoor CPU**, across 1,868 draws. Phase 3 attacks
that directly, and it now has a second benefit the plan did not originally anticipate: fewer draws
also means fewer uniform comparisons, and `#recordUniform` is currently 12.35% of self-time. The two
phases compound rather than overlap.

The Goal's arithmetic still holds and is now the binding issue for 500 fps: non-opaque CPU is
roughly 1.0 ms of a 2.36 ms frame. Phase 3 can plausibly reach the 2.0 ms budget, but only if scene
query and contribution resolution (0.258 + 0.314 ms) do not have to be touched as well. Phase 4
decides that.

**Dungeon: no.** It is at 1.281 ms / 781 fps, its object submission is a small share, and Phase 3
was already scoped outdoor-only. Nothing here changes that.

## Phase 3: Reduce Baked Range Count — outdoor only (conditional on Phase 2)

1,823 baked ranges across 309 layers is the outdoor ceiling, and it pins the GPU as much as the CPU:
3.36 ms of `opaqueMs` for 510k triangles on an RX 7900 XT is command submission, not shading. The
same material binding recurs across many layers, and each occurrence costs a separate draw.

**This phase is outdoor-only, for measured reasons.** Indoors there are only ~538 draws against the
outdoor scene's ~3,228, and the whole indoor frame is 1.425 ms of which portal composition and
ambient occlusion are the large GPU terms. There is nothing there to win, whatever the merging
granularity. (Exact indoor object-submission figures are deliberately not quoted: see Measurement
Constraints — the 60-frame CPU window and single-frame GPU sample both proved unstable for this
scene.) An
earlier draft reached the same conclusion via a wrong argument — that render scope forbids merging —
which does not hold: scopes collapse onto shared atlas tiles by authored `visibilityIslandId`
(`portal-scope-window-culler.ts:240-272`), that collapse is topology-time rather than frame-time
(`:1009-1015`), and the island ordinal ships with the env-cell record itself
(`decode-env-cell-record.ts:741` reading `arrays.islandIndices`, surfaced at
`env-cell-materialization.ts:77`). Indoor merging is _possible_. It is simply not worth doing.

Related, and worth recording so it is not re-litigated: **do not widen EnvCell geometry scoping from
the cell to the block.** Cells are realized individually because many share a CellStruct while each
selects its own materials (`env-cell-materialization.ts:56`, and commit `a06d3ca3`: "shell geometry
is already realized per cell rather than shared by CellStruct identity, so each buffer has exactly
one consumer"). More decisively, portal culling selects 58 scopes out of a block with hundreds at
cull depth 16 — block-granular geometry would draw the whole dungeon every frame to save ~120 draws
that cost 0.1 ms of GPU.

**Memory is cheaper than assumed.** Baking already duplicates geometry per placement, so merging
ranges across layers **re-partitions existing baked data rather than duplicating it** — steady-state
vertex bytes should be roughly flat. The real costs are transient peak during rebuild and any window
where merged and per-layer copies coexist. Phase 0 measures resident geometry bytes to confirm.

**Deliverables**

- Merge baked ranges sharing a material binding across layers within a landblock.
- Fold the per-layer `localToLandblock` into the baked vertices, or rely on Phase 0's identity
  finding — a merged range cannot carry per-layer transforms in a uniform.
- Preserve per-layer invalidation. Layers are the unit content streams in and out on; a merged buffer
  spanning layers must be rebuildable when one constituent layer is withdrawn, without rebuilding
  the rest. An unconditional full-landblock rebuild on every residency change would trade
  steady-state frame time for streaming hitches.
- Decide and document whether merging extends across landblocks. That additionally requires folding
  `uLandblockOffset` into the vertices or an attribute, and interacts with float precision at world
  scale.

**Acceptance**

- `submittedBakedStaticObjectDrawCount` falls substantially, with the figure stated.
- `opaqueMs` falls in proportion; the outdoor GPU is no longer submission-bound.
- A test proves withdrawing one layer's residency does not corrupt or over-invalidate a merged
  buffer.
- Screenshots pixel-equivalent within the noise floor.

## Phase 4: Re-measure

Full capture and profile for both scenes, tabulated. State plainly whether 300 fps and 500 fps are
met on the outdoor reference scene, and if not, what the new dominant cost is.

## Phase 5: Cleanup

- **Fix the silent profiling toggle.** `ExplorerFramePanel`'s profiling button calls
  `setProfilingEnabled` with no try/catch, while `copyReport` and `downloadReport` both catch and
  surface errors into `exportStatus`. `updateRendererFrameProfiling` throws on a missing runtime and
  `setRendererFrameProfilingEnabled` throws on a missing renderer, so a failure leaves the button
  visually inert and every subsequent capture silently unprofiled. This blocked the engine
  measurement three times. Surface the error the way the export buttons do.
- **Rename `transformSource: "baked"`.** It means "transform arrives as a uniform" and is routinely
  misread as "geometry was merged" — a misreading this investigation made. Sweep the vocabulary
  through `webgl2-object-program.ts`, `webgl2-renderer.ts`, the metrics
  (`submittedBakedStaticObjectDrawCount`, `submittedBakedStaticObjectTriangleCount`), and harness
  JSON consumers, per the AGENTS.md rule. `aBakedLight` keeps its name; that one is genuinely baked.
- **Document `WebGL2DeviceDiagnosticIdentity.unmaskedRenderer`'s third state**
  (`webgl2-device.ts:43`). It reads "Privacy-gated constants exposed by `WEBGL_debug_renderer_info`
  when the browser permits it", implying truth-or-`null`. WebKitGTK returns non-null and fabricated.
- **Plumb `selectedRenderDomainCount`** to frame metrics if any later work needs it; otherwise record
  that it was deliberately not added.
- Remove the Phase 0 uniform-redundancy census scaffolding.
- Reconcile any metric this plan adds that has no surviving consumer.

## Risks and Mitigations

| risk                                                                                                                                                 | mitigation                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A uniform writer bypasses the applicator and desyncs the cache, rendering wrong with no error.                                                       | Audit every `gl.uniform*` in the object passes in Phase 1 and route or explicitly exempt each. Screenshot comparison against the noise floor is the backstop.  |
| Cached float comparison misbehaves on `NaN` or `-0`.                                                                                                 | Compare with `Object.is` semantics or explicit component equality; cover in the applicator unit test.                                                          |
| GL uniform state is per-program; resetting the cache on program switch is a silent perf regression, and not keying per program is a correctness bug. | Key on `WebGLUniformLocation`, which is already per-program. Test both directions explicitly.                                                                  |
| Phase 3 merging makes residency invalidation coarser, trading frame time for streaming hitches.                                                      | Acceptance requires a test that a single layer withdrawal does not over-invalidate. The terrain worker already carries a cold-start backlog; do not add to it. |
| Phase 3 grows memory.                                                                                                                                | Expected roughly flat, because baking already duplicates per placement and merging re-partitions. Phase 0 measures resident geometry bytes; state the delta.   |
| Optimizing the outdoor scene while the indoor scene is what users actually struggle with.                                                            | Both scenes are measured at Phase 1, 2 and 4. The indoor bottleneck is recorded under Out of Scope so its plan starts from evidence.                           |
| Screenshots are not byte-identical run to run for reasons AGENTS.md notes were never isolated.                                                       | Phase 0 measures this scene's noise floor first; every later comparison is judged against it.                                                                  |

## Definition of Done

- [ ] `npm run check`, `npm run lint`, `npm run test:ts` pass clean; clippy clean for `src-tauri`.
- [ ] No new `any`/`object` types; no inline lint suppressions.
- [ ] Every phase's measurements recorded here as baseline/after tables, for both scenes.
- [ ] Screenshots pixel-equivalent to baseline within the Phase 0 noise floor at every phase.
- [ ] Outdoor frame cost stated plainly against the 300 fps floor and 500 fps goal, met or not.
- [ ] `baked` vocabulary swept, or a documented decision not to.
- [ ] The profiling toggle reports its own failures.
- [ ] Phase 0 census scaffolding removed.
- [ ] No metric added by this plan lacks a named consumer.

## Resolved Questions

1. **Target scene and bar.** `0xda55ffff`, 300 fps floor, 500 fps goal — with the consequence that
   scene query and contribution resolution can no longer be treated as out of scope.
2. **Memory budget.** Memory-for-speed trades accepted in principle. Phase 0 measures resident
   geometry bytes; Phase 3 records why the multiplier is expected near 1.0x.
3. **Terrain streaming.** A dedicated effort is planned separately; numbers recorded with the
   cold-start caveat.
4. **EnvCell merging.** Possible — islands collapse scopes, topology-time, and the ordinal ships with
   the layer — but not worth doing: indoor object submission is 0.373 ms CPU / 0.096 ms GPU.
5. **Widening EnvCell scoping to the block.** No. Portal culling selects 58 of hundreds of cells at
   depth 16; block granularity would draw the whole dungeon to save draws that cost 0.1 ms.
6. **Portal mode is production.** Flat mode is debug-only and its numbers are not budgets.

## Open Questions

1. **Does the indoor portal path get its own plan, and when?** It is the larger problem by every
   measure except the one this plan targets, and the evidence for it is already gathered.
2. **Does 500 fps need to hold during flight, or only standing still?** Sustained 500 fps while
   crossing landblocks pulls the streaming backlog into this plan's acceptance criteria.
3. **How large is the JSC-vs-V8 gap really?** Blocked on a profiling-enabled Explorer capture at the
   indoor vantage. Phase 5's toggle fix unblocks the measurement; the decision it feeds is
   independent of this plan.

## Decisions and Course Corrections

- **Working tree lost after Phase 2 and recreated.** The branch was reset to `0f5bedb1`, discarding
  all twelve modified files; this plan survived only because it was untracked. The changes were
  rebuilt from the recorded design and re-verified against the figures above rather than assumed
  faithful: `objectDrawCalls`, `objectIdentityTransformUploads` and `geometryResourceBytes` matched
  exactly, and the total uniform set matched at 20,914 with the issued/suppressed split differing by
  3 calls (0.014%) — one draw on a different animation phase in the sampled frame, not a code
  difference. Timings landed within the measured noise floors.
