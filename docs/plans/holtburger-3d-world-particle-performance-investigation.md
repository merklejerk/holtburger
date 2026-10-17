# H3D world particle performance investigation

Status: **Three CPU improvements and the permanent ordinary-particle shader cutover are implemented and validated, 2026-10-16. The temporary bypass switch and portal-particle variant have been removed at the user’s request. The two-program partition remains historical diagnostic evidence. Pre-commit code-quality review completed on 2026-10-17.**

The stationary outdoor scene in landblock `0x482dffff` spends about 5 ms of measured GPU time per frame on particles on the Radeon 780M laptop. Most of that cost belongs to 206 instances of one very large world-effect mesh, `0x01003fa7`. Numeric overlap captures found roughly 27.77 million depth-passing layers per frame from those instances alone. The fragment shader's portal visibility check materially increases their cost, even though the outdoor visibility envelope is unrestricted over 99.43% of the viewport.

This establishes a substantial GPU cost in this scene, but does not establish that the whole application is exclusively GPU-bound. Browser CPU work also consumes a substantial part of the frame budget. The spatial follow-up measured about 1 ms of GPU savings with a separate program in provably unrestricted regions, but its fivefold draw expansion did not improve FPS. A simple shader branch barely helped. A depth-varying experiment makes the captured scene cheaper on this backend, but controlled portal-boundary validation now rejects that direct substitution because visibility decisions change. A retail distance gate is a separate, measured opportunity to reduce workload; it does not answer the renderer-efficiency question by itself.

The GPU follow-up isolates the expensive dependency to builtin fragment Z, rather than the envelope texture fetch itself. Reconstructing depth from clip-space varyings preserves the full portal predicate and reduces live particle GPU time from **5.001 to 3.085 ms** across five paired windows. Total measured GPU time falls from **11.553 to 10.025 ms**, while observed FPS changes only modestly. The replay timing anomaly is resolved: repeated diagnostic CPU reads change the color target’s performance at the tenth readback. Verification now reads disposable copies. The depth-varying candidate has no pixel/portal-decision differences in the captured live scene, but the subsequent synthetic fixture finds repeatable differences at finite portal boundaries, including coplanar and clipped triangles. **The direct substitution is rejected for production.** The performance finding remains valid; a safe implementation requires a different approach or an explicitly designed shared depth contract.

The CPU follow-up measured the shadow feature separately. Five production pairs without V8 sampling reported median frame work of **13.297 ms with shadows / 9.648 ms without**, with **1.758 ms** in the shadow CPU bucket. That quality ablation exposed avoidable work: all 206 gloom owners entered both shadow-cascade queries, then received descriptors/transform copies before their non-caster class was rejected. The implemented early-eligibility query now skips that work. Five alternating original-loop/candidate pairs measured shadow CPU time of **1.741 / 1.197 ms**, about **31% lower**, with exact shadow-selection equivalence in 30 synchronous same-frame comparisons. The particles' conservative color bounds, shaders, population, and quality settings are unchanged. This CPU saving does not remove their approximately 5 ms GPU cost or establish a guaranteed displayed-FPS gain.

A subsequent audit confirmed the same late-admission pattern in analytic grounding and exposed full depth submissions used only as geometry-presence checks. Both follow-up fixes are now implemented: grounding reuses exact admission from the existing color-range walk, and synchronous renderer reads borrow facts while static compilation retains owned copies. A newer live workload loses **292 grounding depth requests per simple-mode frame** and approximately **875 targeted matrix clones per mapped-mode frame**. Grounding's simple-mode CPU-phase saving is **0.381 ms [0.265–0.620]** across five matched rounds. Borrowing's timing lead is smaller and noisy; no aggregate FPS gain is promised. Full same-frame comparisons, 300 fixed compositions, controls, and a normal production smoke are retained below. A portal GPU fixture's particle/transparency failure was reproduced identically on preserved pre-follow-up sources; the next investigation diagnoses its omitted opacity uniform and passes the fixture with a test-only override.

The latest GPU follow-up replaces five spatial draws with two separate programs while retaining exact builtin depth inside the checked region. In a newer, lighter-coverage view, five live pairs save a median **0.817 ms** of particle GPU time but add **0.468 ms** to particle submission CPU, with no consistent synchronous frame-work improvement. Two fresh processes each pass **2,592** finite-boundary/clipping/blend comparisons. The per-draw prototype remains diagnostic. Subsequent manual observation and the user’s explicit cutover decision supersede that design direction: admitted particles now use ordinary scene depth without fragment-level portal clipping.

## Scope and decisions

The user requested profiling with the credentials in `apps/holtburger-3d/.dev.env`, questioned whether large environmental particles explain the laptop's performance, and asked whether our renderer is inefficient relative to retail. Subsequent investigation established that the expensive effects are attached to world owners, rather than the separate sky particle path.

The agreed direction is to understand the bottleneck further while retaining distance or projected-footprint policies as valid ways to reduce workload. An old retail cutoff is evidence of differing workload, not sufficient justification for accepting avoidable cost on modern hardware. A lower-resolution particle pass remains a possible later design, rather than an implemented fix or prerequisite for these experiments.

Live measurements here concern a stationary client; later correctness-only fixtures use synthetic geometry without a server connection. The probes did not drive in-world camera movement or streaming. The user moved and turned the character between later captures and reported that the temporary bypass looked fine; visual acceptance remains with the user. Diagnostics used disposable Electron/CDP probes derived from the existing [live client UI probe](../../apps/holtburger-3d/scripts/live-client-ui-probe.mjs); the TUI was not run. Earlier investigation captures made no production changes. The first authorized fix touched five app-local frontend production files; the two authorized follow-ups bring the total production surface to eight existing frontend files, plus tests. The existing dirty `ACE/` submodule was left untouched.

The initial capture code revision was `26d5c9390476c0d658d8ab669cf317062645bfdf`; the final particle cutover starts from user HEAD `86847980e57b7dcdc2ba54cd7f351ddf073a701e`, retaining intervening user changes and the earlier CPU improvements. The [evidence manifest](evidence/world-particle-performance-2026-10-16/manifest.json) records the ACE revision, retained files, hashes, sanitization, and exclusions. All supporting files linked below are in the repository, independent of `/tmp`.

## Hardware, scene, and measurement method

| Setting | Captured value |
| --- | --- |
| CPU | AMD Ryzen 7 PRO 7840U |
| GPU | AMD Radeon 780M integrated GPU |
| Graphics stack | ANGLE over OpenGL, radeonsi phoenix ACO, Mesa 26.2.3-arch1.1 |
| Shell | Electron 44, Node 22.22.0, Linux |
| Location | Outdoor `0x482dffff`, displayed approximately 65.8S, 44.1W |
| Canvas and drawing buffer | 1493 × 879, render scale 1 |
| Vertical field of view | 75 degrees |
| View distance | 6 |
| Scene interest radii | Terrain 6, buildings 6, explicit objects 1, generated objects 2, environment cells 1 |
| Quality | SAO enabled, shadow maps enabled, anisotropic 2× filtering, weather enabled |
| Visible dynamic entities | 323 in the initial production profile; 302–308 in the later all-particle comparison |

CDP `SystemInfo.getInfo` verified hardware WebGL rather than SwiftShader. The retained [GPU report](evidence/world-particle-performance-2026-10-16/gpu-info.json) omits the process command line.

### Release host versus production frontend

`npm run dev:client:release` builds the Rust host in release mode but still serves the frontend through Vite's development server. The ordinary UI probe's profiling branch also needed a disposable adjustment to select the release host. Neither launch label alone proves the frontend is a production build.

We therefore ran `npm run build` and used a disposable launcher that serves `dist` through `vite preview`, alongside the release Rust host and development Electron shell. The production build succeeded with a chunk-size advisory. Most draw/shader experiments below use this production frontend. Module-level identity, lifecycle, and distance probes use Vite development mode so they can intercept the relevant TypeScript classes. Those exceptions are labeled explicitly.

### What the numbers mean

The browser bridge `window.__holtburgerClientPerformance` provides `reset()`, `setRendererProfilingEnabled(...)`, and `snapshot()`. Snapshots expose synchronous frame work, sampled frame counts, tick phases, renderer CPU phases, asynchronous GPU phase queries, and draw diagnostics.

- **Frame work** is the bridge's mean synchronous frame callback work. It is not the elapsed interval between displayed frames.
- **Observed FPS** is measured frames divided by the measurement window duration. The bridge's estimated “uncapped” rate is not an unthrottled end-to-end benchmark.
- **GPU total** sums nonnested elapsed phase queries. It is not whole-frame GPU latency, occupancy, or a hardware utilization percentage. CPU and GPU timings overlap and must not be added.
- Renderer phase means come from retained rolling samples, typically about 60 frames. A multi-second trial's final GPU snapshot is not an average of every frame in that entire trial. Reported medians below are medians of the five trial snapshots for each variant; brackets give their minimum and maximum, not confidence intervals.
- Initial phase attribution averages ten snapshots sampled roughly one second apart. Those are means of rolling means, not frame-weighted full-window means.
- V8 profiles used 100 µs sampling where stated. Profiling has measurable overhead, and a live scene's population drifts. Compare variants within the same session; do not subtract unrelated sessions as though their workloads were identical.

The initial profiling did not collect native GPU instructions or invocation counters. The later native follow-up retained compiled shader assembly and one desktop replay baseline; GLES invocation counts, bandwidth, actual occupancy, and a Rust stack profile remain unmeasured. A five-second process CPU sample showed a host near 14.8% of one core and several Electron processes around 9.4%, 100%, and 150.8%; without complete process-role attribution or stacks, those samples do not establish a specific bottleneck.

## Baseline attribution

| Run | Mean frame work | Frames / measured duration | Observed FPS |
| --- | ---: | ---: | ---: |
| Release host, Vite development, renderer and V8 profiling | 13.080 ms | 569 / 10.215 s | 55.70 |
| Release host, Vite development, profiling disabled | 11.073 ms | 599 / 10.167 s | 58.92 |
| Release host, production frontend, renderer and V8 profiling | 13.370 ms | 579 / 10.234 s | 56.58 |

The production frontend does not eliminate the observed cost. These are separate live runs, so they do not measure the exact performance effect of bundling or profiling in isolation.

Production renderer attribution, averaged across the ten one-second snapshots:

| Renderer CPU phase | Mean ms | GPU phase | Mean ms |
| --- | ---: | --- | ---: |
| Scene contribution assembly | 2.518 | Particles | 5.178 |
| Outdoor shadow preparation/submission | 1.618 | Portal composition | 2.515 |
| Opaque submission | 1.184 | Near terrain | 1.924 |
| Particle submission | 0.827 | SAO | 0.806 |
| Scene query | 0.579 | Opaque objects | 0.673 |
| Other renderer work | 1.035 | Sky | 0.252 |
| Total, including remaining phases | **9.179** | Total, including remaining phases | **11.683** |

The final production tick sample separately reports about 1.88 ms of presentation publication, 0.645 ms of particle advancement, 0.428 ms of script advancement, and 0.175 ms of animation advancement. Tick and renderer phases are nested measurements, not additive budgets.

V8 samples corroborated work in scene culling, render contribution descriptors, dynamic presentation publication/matrix operations, shadow cascade queries, and particles. Development-mode samples also suggested roughly 0.85 ms/frame inclusive minimap work, about 1.7 ms/frame inclusive IPC/validation work, and approximately 0.6 ms/frame of Zod self time. These are secondary leads from sampled browser stacks, not measured production fixes, and inclusive costs may overlap.

Evidence: [baseline summary](evidence/world-particle-performance-2026-10-16/profile-summary.json), retained baseline JSON and V8 profiles in the [manifest](evidence/world-particle-performance-2026-10-16/manifest.json).

## Removing particle draws isolates substantial GPU cost

The strongest initial ablation skipped only `gl.drawElementsInstanced` for programs containing `uParticleRecords`. Simulation, range collection, uploads, and ordinary submission remained active. Five alternating pairs used four-second measurement windows after 1.5-second settling periods. Only the middle pair also used V8 sampling.

| Production frontend variant | Frame work, median [range] ms | GPU total, median [range] ms | Particle GPU, median ms | Observed FPS, median |
| --- | ---: | ---: | ---: | ---: |
| Draws enabled | 13.287 [13.078–13.855] | 11.290 [11.106–11.575] | 4.998 | 57.24 |
| Draws skipped | 9.844 [9.462–10.943] | 7.207 [6.675–7.290] | Approximately 0 | 59.82 |

Five following windows with profiling disabled measured median frame work of 12.605 ms [12.081–12.991] and 58.46 FPS [56.89–60.17]. Disposable WebGL wrappers were still installed; this is not a pristine instrumentation-free benchmark.

An earlier development-mode pilot suppressed the particle pass through `opacityScale = 0`, measuring median frame work around 11.68 → 8.08 ms and GPU total around 11.25 → 7.26 ms. That approach could skip record uploads and resume with stale dirty-record state. It was superseded by the production draw-only experiment above. The pilot script was subsequently corrected but not rerun; its archived source must not be mistaken for the exact original pilot implementation.

Raw skipped draw totals in the production capture include settling time. The corrected summary names them `skippedPhysicalDrawsIncludingSettle`; dividing those counts by measured frame counts would produce misleading draws/frame.

Evidence: [production draw comparison](evidence/world-particle-performance-2026-10-16/production-ablation.json.gz), [summary](evidence/world-particle-performance-2026-10-16/profile-summary.json), and the `production-particles-on/off.cpuprofile.gz` pair listed in the manifest.

## World effects, mesh size, and asset identity

### The separate sky path is inexpensive here

Programs lacking `uPortalRenderDomain` identify the separate sky particle path in the captured compositor mode. The census found three sky draws per frame versus roughly 375–380 world draws. Five reordered three-second windows per variant, after one-second settling periods, measured:

| Sky experiment | Median particle GPU ms |
| --- | ---: |
| Normal | 4.689 |
| Skip sky draws | 4.621 |
| Skip world draws | 0.218 |
| Sky mesh half scale | 4.620 |
| Sky mesh quarter scale | 4.621 |
| Sky mesh collapsed to zero area | 4.489 |

The user's distinction was correct: an effect can look like sky gloom while belonging to the world-effect path. Optimizing the dedicated sky path would miss the main cost in this capture.

### Changing authored mesh scale is not a clean screen-area experiment

A vertex-shader diagnostic multiplied the original `aPosition * scale` term by an additional factor, without changing draw or instance counts. Applying this to world effects produced a surprising result:

| World mesh experiment | Median particle GPU ms |
| --- | ---: |
| Normal | 5.076 |
| Half scale | 8.116 |
| Quarter scale | 10.876 |
| Collapsed to zero area | 0.771 |
| Skip world draws | 0.654 |

These are very large authored meshes around world origins, rather than simple screen-facing sprites with an independently adjustable on-screen size. Changing their world scale changes clipping and projected coverage. The exact reason for the nonmonotonic half/quarter results remains unresolved. They do not show that small particles are intrinsically more expensive.

Collapsing geometry to zero area retains submission and vertex work while eliminating rasterized area, and removes most of the measured particle cost. The later scissor and overlap experiments provide more controlled evidence about pixel workload.

### One authored mesh dominates

The census identified 206 single-instance draws of one 330-index mesh: 110 triangles per instance, 22,660 triangles across that population. A separate release-host/development-frontend `ParticleMeshResidency.resolve` hook identified it as `0x01003fa7`; it was the only observed 330-index particle mesh. Temporary geometry enumeration number `4` was a capture-local handle, not an asset ID.

| Dominant mesh property | Value |
| --- | --- |
| GfxObj | `0x01003fa7` |
| Authored orientation | `0`, authored frame |
| Local bounds minimum | (-1014.2700, approximately 0, -964.6250) |
| Local bounds maximum | (1014.2700, 1014.2700, 964.6250) |
| Dimensions | Approximately 2028.54 × 1014.27 × 1929.25 world units |
| Observed scale range | 0.9900166–1.0099437 |
| Material kind | `1`, direct-color texture sampling |

All particle materials in the census were direct-color materials, so palette filtering does not explain this workload. Other observed particle meshes generally had only 12 indices. No location/lore name or named scene owner has been established for the gloom; the asset, emitter ID, and landblock are the durable identifiers.

Evidence: [experiment and asset summary](evidence/world-particle-performance-2026-10-16/particle-investigation-summary.json), [mesh identities](evidence/world-particle-performance-2026-10-16/particle-identities.json), [world census](evidence/world-particle-performance-2026-10-16/world-particle-census.json.gz), and the sky/world-size captures in the manifest.

## Portal filtering cost and why outdoor effects use it

### Renderer ownership and routing

This policy belongs to the app's browser renderer. In [`webgl2-renderer.ts`](../../apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts), `#preparePortalContributions` resolves each owner through the render world, mapping exterior owners to the `outdoor` scope and dedicated sky effects to `sky`. `#executePortalScopeAtlasFrame` draws scoped particles after opaque scope rendering/composition. The [particle pass](../../apps/holtburger-3d/src/lib/game/renderer/webgl2-particle-pass.ts) uses the portal-aware program for world particles; the [scope atlas pipeline](../../apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-scope-atlas-pipeline.ts) selects a domain per deferred submission.

The [deferred visibility predicate](../../apps/holtburger-3d/src/lib/game/renderer/portal-deferred-visibility-glsl.ts) loads scope metadata, checks screen bounds, looks up an envelope texture, and accepts a fragment when the envelope is unrestricted (`1`) or the fragment lies before its encoded exit depth. The [envelope sampler](../../apps/holtburger-3d/src/lib/game/renderer/portal-envelope-sampling-glsl.ts) first fetches one texel; if it is zero, a radius-two gutter search performs up to 25 additional fetches. The [scope envelope reduction shader](../../apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-scope-atlas-programs.ts) encodes uncovered pixels as zero, finite exits as half depth, and unrestricted appearances as one.

An outdoor camera does not make all exterior particles safe to draw without filtering. At a doorway or window, an exterior effect can project into an interior appearance and lie in front of an interior wall in ordinary depth terms. Domain exit visibility must still limit it. Correctly routing an effect to `outdoor` therefore does not imply it can globally bypass the portal shader.

### Gutter search and population ablations

The first fragment experiment applied world shader variants and separately removed the dominant mesh population:

| Variant | Median particle GPU ms [range] |
| --- | ---: |
| Normal | 4.877 [4.718–5.227] |
| Remove gutter search | 4.835 [4.716–4.963] |
| Bypass portal predicate | 2.586 [2.525–2.945] |
| Skip the 330-index mesh population | 0.559 [0.526–0.986] |
| World mesh quarter scale | 10.159 [9.722–10.764] |
| Quarter scale, remove gutter search | 10.093 [9.730–10.595] |

Removing the dominant mesh eliminates about 89% of particle phase time in this session. Removing the gutter search barely helps at original scale or quarter scale. Bypassing the full portal predicate helps substantially, but changes visibility and is diagnostic only.

The first attempted capture of this experiment failed shader compilation because a diagnostic uniform was declared after a helper that used it. That run was discarded. The retained `fragment-investigation` capture used the corrected declaration and valid GPU measurements; the failed run is excluded from the evidence archive.

Evidence: [fragment experiment](evidence/world-particle-performance-2026-10-16/fragment-investigation.json.gz), [summary](evidence/world-particle-performance-2026-10-16/particle-investigation-summary.json).

## Emission, lifetime, and the missing retail distance gate

### The 206 instances have distinct owners

A creation hook installed before world entry observed 206 dominant-mesh emitter creations, 206 distinct scene-node owners, and 206 distinct origins. Every creation used definition `0x32000923`, emitter ID zero, a zero hook offset, and a frame target equal to its owner.

| Emitter property | Captured value |
| --- | --- |
| Maximum live particles | 1 |
| Initial particles | 0 |
| Birthrate / mode | 0.05 seconds, emits per second |
| Total particle / time limits | Both zero |
| Persistent | True |
| Particle lifespan | 60 seconds |
| Motion type | 9 |
| Follows parent | False |
| Start / final scale; variance | 1 / 1; 0.01 |
| Start / final translucency; variance | 0.8 / 0.5; 0.1 |
| Mesh radius / maximum scale | 1014.27 / 1.01 |
| Emitter center reach | 18.1 |

Six samples over 25 seconds after settling retained 206 dominant particles with no additional creation calls. A later run crossed a full particle lifetime: birth timestamps advanced from about 7.09 to 67.10 seconds while the create count stayed 206. This trace supports legitimate distinct world placements rather than duplicate creation accumulating every frame. It does not rule out leaks in unrelated effects or lifecycle transitions.

### Retail applies a separate distance limit

The retail decompile establishes the following chain:

| Retail reference in `acclient-eor-source/acclient.c` | Behavior |
| --- | --- |
| `CPhysicsPart::GetMaxDegradeDistance`, line 302927 | Uses authored degrade bands when present; otherwise returns 100 |
| `ParticleEmitter::SetInfo`, lines 317995 and 318042 | Creates particle parts and caches their maximum degrade distance |
| `CPhysicsObj::UpdateViewerDistance`, lines 306288–306310 | Computes Euclidean distance from viewer to the emitter physics-object origin into `CYpt` |
| `CPhysicsObj::ShouldDrawParticles`, line 305645 | Rejects particles beyond that distance or without visible cell membership, except examination objects |
| `ParticleEmitter::SetParenting`, line 317404 | Attaches the emitter object through its parent/part/hook frame |
| `ParticleEmitter::UpdateParticles`, line 318174 | Applies visibility and the persistent/finite hidden-emitter lifecycle policies |
| `ParticleManager::CreateParticleEmitter`, line 316606 | Replaces an existing nonzero emitter ID; allocates an ID for a zero-ID request |
| `ParticleEmitterInfo::ShouldEmitParticle`, line 312447; `ParticleEmitter::InitEnd`, line 318337 | Govern emission budgets/rate/capacity and the initial burst |

For the actual mesh, flags are `0x2` (`HAS_DRAWING`), without `HAS_DID_DEGRADE` (`0x8`). Exports from both the HBA bundle and raw retail portal DAT were byte-identical, 6,160 bytes, SHA-256:

```text
9b5022df2c52d5daf6c18f034b75f37350d2d3c34af96ecd82e0907af8951541
```

Thus the retail fallback is 100 units for this asset. The raw copyrighted mesh bytes are not retained in this investigation's evidence folder; decoded bounds, identity, and the digest are retained.

The ACE server's [`ParticleEmitter.cs`](../../ACE/Source/ACE.Server/Physics/Particles/ParticleEmitter.cs) explicitly says `omitted degrade distance` and sets it to `float.MaxValue`. That server implementation cannot resolve a client rendering-policy question.

Our [host particle mesh adapter](../../apps/holtburger-3d/host/src/particle_mesh_source.rs) resolves near-band orientation but does not export a maximum draw distance. The runtime emitter mesh contract carries ID and radius. The app does not currently apply this independent retail distance gate.

The larger conservative envelope in [`particle-system.ts`](../../apps/holtburger-3d/src/lib/game/systems/particle-system.ts) is an intentional existing `RETAIL DIVERGENCE`: retail's sorting sphere omits mesh extent and other motion terms. Correct geometric bounds and an independent distance policy answer different questions. Shrinking those bounds to force culling would undo the documented correction rather than implement the missing distance policy.

### Draw-only distance experiment

A release-host/development-frontend probe computed camera-to-owner distances using actual camera events and resolved scene origins. Of 206 dominant owners, 73 lay within 100 units. A draw-range filter removed the other 133 while leaving simulation, emission, particle geometry, render scale, and portal checks unchanged. Five alternating pairs used four-second windows after two-second settling periods.

| Metric | Current, median [range] ms | 100-unit cutoff, median [range] ms |
| --- | ---: | ---: |
| Particle GPU | 5.113 [5.049–5.504] | 2.233 [2.072–2.829] |
| GPU total | 11.420 [11.273–11.993] | 8.652 [8.396–9.265] |
| Frame work | 13.031 [12.519–13.450] | 10.053 [9.476–11.189] |

This proves a material workload difference from retail for this population. It is not a complete restoration of retail behavior: the current runtime already has hidden persistent/finite emitter bookkeeping, and a production policy must integrate drawing and lifecycle admission consistently. An all-mesh authored-distance census has not been performed; hardcoding this asset or a universal 100-unit limit would not establish the general contract.

Evidence: [distance summary](evidence/world-particle-performance-2026-10-16/distance-cutoff-summary.json), [creation and lifetime audit](evidence/world-particle-performance-2026-10-16/emitter-audit.json.gz), [distance trials](evidence/world-particle-performance-2026-10-16/distance-cutoff-experiment.json.gz).

## Deeper fragment experiments

These later experiments returned to the production frontend and changed only the 330-index dominant population. They retained 206 dominant draws and instances per frame.

### Material, blending, portal checks, and rasterized area

Five reordered three-second windows per mode, each after one second of settling:

| Variant | Median particle GPU ms [range] |
| --- | ---: |
| Normal | 4.859 [4.825–4.905] |
| Constant material color | 4.651 [4.440–4.852] |
| Disable blending | 4.873 [4.752–5.050] |
| Bypass portal predicate | 2.797 [2.699–3.012] |
| Constant color, no portal predicate, no blending | 1.681 [1.647–1.992] |
| Central scissor with half width and half height | 1.226 [0.775–1.272] |

Material sampling or blend bandwidth alone does not explain the normal path's cost. The combined experiment is faster than either isolated change, so these differences must not be added as independent savings. Portal bypass, constant color, and changed blending alter output and are not shipping candidates as tested.

The scissor admits one quarter of viewport area while retaining geometry and draw counts. Its large GPU reduction strengthens the pixel-work explanation without changing world-space mesh size. The disposable scissor wrapper also makes synchronous GL state queries on each draw, inflating CPU frame work to roughly 26 ms; it provides no CPU or FPS improvement claim.

The captured dominant draw used outdoor domain ordinal zero, full-view root metadata `[0,0,0,0,1493,879,0,0]`, material kind 1, alpha-test threshold zero, and opacity scale 1. Depth testing was enabled with `LEQUAL`, depth writes disabled, face culling enabled, and ordinary alpha blending enabled (`FUNC_ADD`, `SRC_ALPHA`, `ONE_MINUS_SRC_ALPHA` for RGB and alpha).

### Numeric overlap capture

A diagnostic RGBA32F target accumulated one per accepted dominant fragment, optionally sharing the real opaque depth attachment. This measured overlap numerically; it was not a screenshot or visual acceptance check.

| Counter mode | Sum of layers | Mean across all viewport pixels | Maximum layers | Pixels with all 206 layers |
| --- | ---: | ---: | ---: | ---: |
| After normal portal/alpha checks, opaque depth enabled | 27,769,339 | 21.160 | 206 | 133,927 |
| Coverage before portal/alpha checks, opaque depth enabled | 27,772,578 | 21.163 | 206 | 133,927 |
| Coverage before portal/alpha checks, opaque depth disabled | 99,941,112 | 76.154 | 206 | 475,774 |

The first mode covered 144,891 distinct pixels, so the full-viewport mean hides a much denser concentration. Adjacent frames differ slightly; differences between these sums are not exact portal rejection counts. These are accumulated depth-passing coverage counts, not hardware shader invocation or occupancy counters. A second run reproduced roughly 27.77 million depth-passing and 99.94 million depth-disabled layers.

### Most outdoor pixels are unrestricted, but a simpler lookup did not help

A numeric readback of the outdoor envelope found 1,304,834 unrestricted pixels, 7,513 finite-depth pixels, and no uncovered pixels out of 1,312,347 total. Thus 99.4275% were unrestricted and 0.5725% finite. Finite encoded depths ranged from 0.4970703125 to 0.499267578125.

A root-specific shader variant replaced the metadata/bounds calculation with a direct screen-pixel lookup, retaining the finite-depth comparison and falling back to the existing gutter behavior for zero values. The measured full-view, zero-offset root metadata met its diagnostic preconditions. A numeric mismatch counter found zero differences from the original predicate on one captured frame across the 206 draws; this is not a general equivalence proof.

| Same-session variant | Median particle GPU ms [range] |
| --- | ---: |
| Normal | 4.963 [4.794–5.658] |
| Simpler root lookup | 4.936 [4.809–6.207] |
| Bypass portal predicate | 2.907 [2.732–3.254] |

Simplifying root address calculations did not produce a repeatable meaningful improvement. Avoiding unnecessary lookups is a different, still unmeasured hypothesis.

### Removing `discard` did not improve performance

A separately compiled particle program removed every `discard`, replacing portal/alpha rejection with transparent-zero output while retaining the visibility predicate. The probe mirrored uniform uploads between the original and alternate programs and checked neutral blend preconditions: additive blend equations, supported destination factors, and no canvas emission. It recorded no unsupported blend policies or browser exceptions.

Five alternating pairs used four-second windows after 1.5-second settling periods:

| Variant | Median particle GPU ms [range] |
| --- | ---: |
| Original | 5.301 [4.912–5.367] |
| Transparent rejection mask | 5.500 [4.979–5.522] |

There was no speedup. The evidence does not establish a driver early-depth failure, nor justify a production rewrite around transparent masking. No visual acceptance is claimed for the alternate program.

Evidence: [bottleneck summary](evidence/world-particle-performance-2026-10-16/particle-bottleneck-summary.json), [fragment trials](evidence/world-particle-performance-2026-10-16/fragment-costs.json.gz), [overlap counters](evidence/world-particle-performance-2026-10-16/overlap-counters.json), [root trials](evidence/world-particle-performance-2026-10-16/root-fast-costs.json.gz), [root counters](evidence/world-particle-performance-2026-10-16/root-overlap-counters.json), [envelope census](evidence/world-particle-performance-2026-10-16/outdoor-envelope.json), [discard trials](evidence/world-particle-performance-2026-10-16/discard-costs.json.gz).

## Spatial lookup avoidance follow-up

Status: **Measured on 2026-10-16. A conservative region is available, but neither tested execution path provides a demonstrated FPS improvement. No production code was changed.**

### A region derived from the existing frame plan

The [crossing stream](../../apps/holtburger-3d/src/lib/game/renderer/portal-crossing-triangle-stream.ts) already uploads the selected crossing triangles with their source domain and the frame's anchor-to-clip matrix. The propagation shader starts in root arrival state one. A pixel cannot leave that root domain without rasterizing a selected crossing sourced from the root. Outside the projected union of all such crossings, every propagation round therefore retains the root as unrestricted. Return crossings, later frontiers, and finite exit depths cannot change that conclusion outside the first-departure coverage.

The disposable production probe mirrored the existing CPU uploads and projected every root-sourced triangle. It took their enclosing screen rectangle, inflated it by three pixels, and clamped it to the viewport. Any triangle vertex with nonpositive or near-zero clip `w` causes a full-viewport fallback. That fallback sacrifices savings when the diagnostic cannot bound a near-eye crossing. Decisions used the uploaded frame plan, with no GPU readback as policy input.

The retained scene had 13 root-sourced crossings, 34 triangles, and the stable half-open pixel rectangle **[459, 480, 1122, 588)**. Its 71,604 pixels cover 5.4569% of the viewport. The remaining 1,240,743 pixels, or 94.5431%, can bypass the portal predicate in this captured view.

After each timing window, a separate envelope readback checked every skipped pixel for exactly unrestricted depth one. All **45 checks** across the three experiments found **zero unsafe pixels**. Readback was validation after measurement, not a production strategy. This establishes the captured frame's envelope behavior; the three-pixel guard is a diagnostic margin, not a formal floating-point error bound for every possible scene. Indoor views, near-plane fallback behavior, root changes, traversal retreat, and re-entry still need broader acceptance before a production cutover.

### A shader branch barely changed the cost

The first variant returned visible before metadata/envelope lookup when the fragment was outside the conservative rectangle; inside, it used the original predicate. It retained the same draws, geometry, instance data, simulation, material, blend/depth policy, and portal routing. Five reordered four-second windows per mode followed 1.5-second settling periods, without V8 sampling.

| Variant | Particle GPU, median [range] ms | GPU total, median [range] ms |
| --- | ---: | ---: |
| Original path | 4.591 [4.542–4.892] | 11.164 [10.890–11.349] |
| Spatial branch | 4.536 [4.460–4.701] | 10.924 [10.672–11.139] |
| Unconditional bypass, diagnostic control | 2.616 [2.523–2.970] | 9.090 [9.053–9.959] |

The spatial branch saved only about 0.055 ms of particle GPU time, within overlapping trial ranges. A second session reproduced the lack of meaningful improvement: 4.711 ms original versus 4.702 ms with the branch. Counting unrestricted screen pixels alone therefore does not predict the speed of this shader expression.

### Separate programs improve GPU time but add submission work

The next diagnostic partitioned each dominant draw into five disjoint scissor rectangles: the affected center rectangle and four surrounding strips. It used the original shader in the center and an alternate shader without the portal predicate outside. Scissors preserve per-pixel draw order, so the logical 206-effect population, motion, materials, and transparency order stay the same. Vertex work repeats, and physical dominant draws rise from 206 to **1,030 per frame**. Other particle populations stay on their original path.

The first implementation mirrored all uniform values to the alternate program on each split draw. It removed the predicate call but retained unused portal declarations. The refined diagnostic removed all portal declarations/helpers from the outside shader, verified that its portal uniform block was absent, forwarded only changed uniforms, and required the dominant draws to belong to root domain zero. The two changes were made together; their individual contributions were not isolated.

| Same-session comparison | Variant | Particle GPU, median [range] ms | GPU total, median ms | Frame work, median ms | Observed FPS, median |
| --- | --- | ---: | ---: | ---: | ---: |
| Naive split | Original | 4.711 [4.532–4.863] | 11.137 | 13.438 | 57.506 |
| Naive split | Split | 3.823 [3.704–4.268] | 10.709 | 14.377 | 54.337 |
| Refined split | Original | 4.682 [4.643–5.188] | 11.108 | 13.476 | 56.994 |
| Refined split | Split | 3.692 [3.646–3.817] | 10.196 | 13.471 | 56.384 |

The naive split saved about 0.887 ms of particle GPU time but increased synchronous frame work by roughly 0.939 ms and lowered observed FPS. The refined split saved about **0.990 ms**, or **21.2% of the particle phase**, and about **0.912 ms of total measured GPU time**. Its median synchronous frame work was essentially unchanged, and it did not improve median FPS. Those CPU/FPS results still include disposable buffer mirrors, per-frame GL state inspection, and uniform-forwarding bookkeeping installed in both variants; they are not a forecast of a production implementation's cost.

### Layer counts exclude a simple screen-coverage explanation

An RGBA32F additive diagnostic on the actual dominant draws counted original accepted layers, layers outside the conservative rectangle, all depth-passing layers, and visibility disagreements. Three frames in each split session, six total, found approximately **27.77 million layers per frame**, all outside the conservative rectangle, and **zero visibility disagreements**. The three final refined-run counts are retained in the summary and raw capture.

These counters count fragments that pass opaque depth. They do **not** prove the GPU avoided portal lookups on fragments rejected by depth, or tell us where the driver schedules those lookups. We have not established why the cheap spatial branch failed to realize the benefit seen with a separate program. Compiler scheduling, register pressure, and depth rejection remain hypotheses, not findings. The earlier `discard` replacement already failed to provide evidence for a simple early-depth explanation.

### Result and next investigation

There is measurable renderer overhead independent of particle count, distance culling, or lower-resolution rendering: the spatial split preserves the captured visibility while reducing GPU elapsed time. The tested split is still an unattractive production cutover because it multiplies dominant draw calls fivefold without a demonstrated FPS improvement. The straightforward branch is also not an optimization worth adopting on these results.

The next focused step is a GPU-level capture of the branch and separate-program variants to distinguish actual shader invocations/depth rejection from shader resource or scheduling cost. Any production design should retain the existing frame plan as the authority for conservative regions, avoid per-draw program/uniform duplication, preserve transparent ordering, and demonstrate an end-to-end benefit. A distance/footprint policy remains independent of that work.

Evidence: [spatial summary](evidence/world-particle-performance-2026-10-16/spatial-visibility-summary.json), [branch trials and envelope proofs](evidence/world-particle-performance-2026-10-16/spatial-costs.json.gz), [naive split trials and layer counters](evidence/world-particle-performance-2026-10-16/split-costs.json.gz), [refined split trials and layer counters](evidence/world-particle-performance-2026-10-16/split-clean-costs.json.gz), [spatial diagnostic source archive](evidence/world-particle-performance-2026-10-16/spatial-diagnostic-probes.tar.gz).

## Native GPU inspection follow-up

Status: **Compiler inspection and clean program comparison completed on 2026-10-16. One native replay baseline is valid; a later replay lost its GPU context, so no paired replay-counter claim is made.**

### Actual GLES shader compilation

The original Wayland path uses ANGLE over Mesa's native OpenGL ES 3.2 context. An offscreen EGL capability probe verified that the same Radeon 780M also supports desktop OpenGL 4.6. Desktop OpenGL capability does not mean the existing Electron run used that API.

The installed Mesa driver advertised `AMD_DEBUG` flags `ps`, `initnir`, `nir`, `asm`, and `stats`. A stationary production/release run enabled those flags, disabled the shader disk cache for capture, and dumped the native GLSL supplied by ANGLE. Its 20 timing windows and envelope checks are retained as diagnostic context, not a new pristine performance baseline. The attempted Gallium HUD pipeline counters produced no CSV samples in this offscreen Electron path; there are no HUD counter results to interpret.

Native fragment shader `source_blake3` keys were matched, in little-endian word order, to the dumped GLSL filenames. The relevant compiled variants of the earlier instrumented shader reported:

| Variant | VGPRs | Code size, bytes | Wave size | Compiler maximum waves | Scratch / spills |
| --- | ---: | ---: | ---: | ---: | --- |
| Original predicate | 32 | 1,224 | 64 | 16 | Zero |
| Spatial branch | 32 | 1,312 | 64 | 16 | Zero |
| Unconditional bypass | 16 | 376 | 64 | 16 | Zero |
| Separate program with portal code removed | 16 | 220 | 64 | 16 | Zero |

The spatial variant's disassembly computes the rectangle tests and branches around the scope metadata/envelope loads. Its envelope read was **not hoisted unconditionally ahead of that branch**. The material texture sample appears earlier in the generated code, so skipping an envelope lookup does not skip every texture operation. The compiler reports no spill or reduction in its maximum-wave bound for the spatial variant. That bound is not a measurement of actual occupancy, latency hiding, or bandwidth utilization.

The driver output also showed the diagnostic uniforms in specialization keys. This created a methodological question: could those uniforms explain the branch's poor result? We answered it with clean programs rather than assuming the dump established a cause. Compiler output from asynchronous compilation can interleave; the retained assembly files are explicitly filtered excerpts, with the original statistics, keys, and source hashes attached.

Evidence: [native GPU summary](evidence/world-particle-performance-2026-10-16/native-gpu-summary.json), [spatial native assembly excerpt](evidence/world-particle-performance-2026-10-16/native-region.asm.txt), [translated native world shader](evidence/world-particle-performance-2026-10-16/native-instrumented-world.glsl).

### Clean programs retain most of the portal cost

A new comparison kept the original scoped particle fragment source untouched. Two alternate programs implemented the spatial branch or removed portal code. Program selection moved to the CPU; none of the three shaders added diagnostic uniforms or layer-counter branches. The spatial program used the captured fixed rectangle `[459,480,1122,588)` as literals, avoiding even a diagnostic rectangle uniform. Each timing window verified both rectangle equality with the current frame plan and zero unsafe skipped envelope pixels.

This comparison selects variants for the scoped world-particle program, including the other world effects, and retains the same dominant 206-instance population. It differs from the earlier dominant-only experiment and must be compared within its own session. Five reordered four-second windows per variant followed 1.5-second settling periods; V8 sampling was disabled. CPU uniform-forwarding and frame-plan inspection wrappers were present in all variants.

| Clean program | Particle GPU, median [range] ms |
| --- | ---: |
| Original shader | 5.166 [4.831–5.543] |
| Fixed-region branch | 4.853 [4.698–5.085] |
| Portal code removed, diagnostic control | 2.953 [2.818–3.034] |

The branch's median improvement is about 0.313 ms, or 6.1%, while a much larger gap to unconditional bypass remains. Trial ranges overlap; two of five corresponding rounds made the branch slightly slower. All 15 envelope checks passed. The previous diagnostic uniforms are therefore not a sufficient explanation for the branch retaining most of the portal cost. No shipping shader change or robust FPS improvement has been established by this comparison.

The first clean-program attempt accidentally selected another deferred shader and failed compilation before measurement. It was discarded. The successful hook explicitly selects particle shaders before cloning programs.

Evidence: [clean program timing windows and proofs](evidence/world-particle-performance-2026-10-16/clean-program-costs.json.gz), [native GPU summary](evidence/world-particle-performance-2026-10-16/native-gpu-summary.json).

### Native replay counters have a different backend and viewport

RenderDoc 1.46 and the Qt libraries needed by its scripting interface were extracted under `/tmp`, without installing system packages. Its headless instance used a temporary config with analytics disabled. Ordinary generated tool caches may exist outside that directory. The initial all-child injection failed Chromium zygote startup; the default Wayland path also reported `EGL_BAD_MATCH` when RenderDoc tried to clone the GLES context. A temporary launcher used X11, an in-process GPU, and debugging sandbox flags to obtain native frames.

That launcher used **Mesa desktop OpenGL 4.6** and a **1498 × 920** canvas, rather than the original native GLES backend and 1493 × 879 canvas. Those differences matter: raw counts and replay timing cannot be treated as the original run's counters or frame budget.

The capture controller initially accepted stale capture notifications on reconnect. Baseline identity was subsequently verified independently through shader reflection: all 206 selected 330-index, one-instance draws read particle records, used portal fragment code, and had no fixed-region branch. The baseline frame contained 1,557 actions overall.

| Native baseline replay counter, dominant population only | Value |
| --- | ---: |
| Dominant draws | 206 |
| Fragment shader invocations | 35,050,992 |
| Samples passed | 30,553,386 |
| Vertex shader invocations | 67,980 |
| Fragment invocations per passed sample | 1.147 |

This baseline does not show several-fold fragment-invocation inflation over passed samples on the desktop backend. It does not establish the GLES path's invocation count, quantify its rejected fragments, or provide a comparison against the spatial or bypass programs. Per-draw replay duration sums include query/replay overhead and are not substituted for live renderer timings.

The X11 spatial frame also retained the old fixed rectangle while the derived X11 rectangle was `[448,503,1142,616)`. Its visibility equivalence was not established, and its capture is not accepted as a correctness comparison. Only original-shader baseline replay counters are used.

Replay of the second captured frame then aborted with exit status 134 and reported: `amdgpu: The CS has cancelled because the context is lost. This context is innocent.` It produced no valid counter result. Further replay attempts stopped. This is an observed capture/replay failure, not proof of a fault in the product renderer or a diagnosed driver bug. Afterwards, read-only GPU telemetry responded, and the identified disposable capture clients were closed.

Raw `.rdc` files contain resident game resources and potentially launch/UI data, so they are not copied into the repository. The accepted baseline's digest, size, shader identity checks, per-draw counters, and totals are retained. No screenshots or visual acceptance checks were performed.

Evidence: [accepted native baseline counters](evidence/world-particle-performance-2026-10-16/native-replay-baseline-counters.json), [native capture limitations and digest](evidence/world-particle-performance-2026-10-16/native-gpu-summary.json), [native diagnostic sources](evidence/world-particle-performance-2026-10-16/native-diagnostic-probes.tar.gz).

The [Mesa environment-variable reference](https://docs.mesa3d.org/envvars.html), [Gallium query definitions](https://docs.mesa3d.org/gallium/context.html#queries), and [RenderDoc counter example](https://github.com/baldurk/renderdoc/blob/v1.46/docs/python_api/examples/renderdoc/fetch_counters.rst) describe the tooling and counter contracts. The local captures establish the findings above.

### Remaining attribution question

The current evidence still does not identify the exact GLES hardware bottleneck responsible for the spatial branch retaining most of the portal cost. It rules against a simple unconditional envelope-fetch hoist, shader spills, and the added diagnostic uniforms as sufficient explanations. The one desktop baseline also fails to substantiate catastrophic late-depth amplification. Actual GLES occupancy, memory stalls, cache behavior, and shader-invocation counts remain unmeasured.

The frozen follow-up below reproduces the original-backend cost gap. Its initial expanded comparisons were contaminated by repeated direct CPU readbacks of the measured color resource. The subsequent readback/depth follow-up resolves that anomaly, repeats the comparisons with disposable readback copies, and isolates a promising fragment-depth representation change.

## Frozen GLES workload follow-up

### Reproduction method

A disposable WebGL hook captures one complete frame's 206 dominant draws before freezing application `requestAnimationFrame` callbacks. It retains the real mesh/index buffers, particle-record texture, material texture/samplers, uniform values, scope metadata, and envelope texture in the original context. Before the first dominant draw, it copies the scene's RGBA8 color and DEPTH_COMPONENT24 depth into a private target. Replays reset the captured background color, then submit only those 206 draws with frozen motion time and original blend/depth/cull state. Depth writes remain disabled.

This avoids another RenderDoc replay and verifies the original hardware path: `ANGLE (AMD, AMD Radeon 780M Graphics (radeonsi phoenix ACO), OpenGL ES 3.2)`. It removes scene assembly, other render phases, other particle draws, and presentation from the timed workload. It retains the live host connection for resource lifetime; it is not yet a portable fixture independent of login. Actual resources and pixel arrays stay in the page, with only numeric state, comparisons, and timings retained.

Elapsed GPU queries cover replay draws and uniform commands. Background reset blits, image readbacks, setup, and eight warm-up replays per window are excluded. The first and independent minimal-repeat captures each have five reordered windows per variant and 40 accepted query samples per window. Reported values are medians of window means. Queries reject clock disjointness and GL errors. These are isolated workload times, not live FPS measurements.

The first and repeat viewports were 1499 × 884 and 1503 × 889, respectively. The projected portal rectangle is derived afresh for each captured view. All draws are checked for root domain 0, the same mesh/material bindings, one instance per draw, and matching raster state. Intercepted live instanced submissions remain zero while frozen.

### The original cost gap survives isolation

| Program | First frozen capture, ms | Independent minimal repeat, ms |
| --- | ---: | ---: |
| Original portal predicate | 4.854 | 4.981 |
| Branch outside the derived portal rectangle | 4.819 | 4.932 |
| Direct root-envelope texel lookup; no scope metadata/gutter | 4.841 | 4.951 |
| Rectangle branch plus direct lookup | 4.813 | 4.929 |
| Portal code removed | 2.487 | 2.551 |

Every variant produced exactly the same RGBA8 output as the original predicate in its frozen capture. The repeat also verified a nonempty effect—146,284 pixels differ from the captured background—and zero output changes after timing. Pixel equality applies to these frozen inputs; it does not establish general portal correctness or visual acceptance.

The isolated workload reproduces roughly 2.4 ms of portal-associated cost. Live scene assembly, IPC, and the other rendering passes are therefore not required to reproduce that gap. Neither a direct texel lookup nor the rectangle branch recovers it here.

Disabling fixed-function depth testing increased the first original/no-portal times to 11.644 / 5.687 ms. The repeat gave 11.406 / 7.847 ms. Depth testing materially reduces the workload in both programs. These elapsed times do not establish how many shader invocations depth testing rejects.

Evidence: [frozen GLES summary](evidence/world-particle-performance-2026-10-16/isolated-gles-summary.json), [first capture](evidence/world-particle-performance-2026-10-16/isolated-gles-first-costs.json.gz), [independent minimal repeat](evidence/world-particle-performance-2026-10-16/isolated-gles-minimal-repeat-costs.json.gz).

### Initial expanded controls were contaminated by direct readbacks

Additional diagnostics tested transparent-zero output instead of all fragment discards, a coordinate-only discard, one instanced draw with a 206-entry vertex-uniform slot remap, and copying the depth-format envelope into an R32F color texture. Their frozen outputs also matched, but the no-portal control rose from about 2.5 ms to 4.7–4.9 ms. The original portal program stayed near 5 ms. Independent expanded and narrower runs reproduced this sensitivity.

A phased session then ran the small and expanded program sets sequentially on the **same frozen mesh, records, uniforms, depth, envelope, and background**. The no-portal median changed from 2.530 ms initially to 4.748 ms after the extra controls, and remained 4.935 ms after recreating the minimal program set. Each stage retained stable output after its own setup, with 148,298 affected pixels, zero changed pixels after timing, zero extra live instanced draws, and no GL error. The original phased probe reset its reference at each setup; the corrected follow-up below additionally keeps one byte-for-byte reference across all stages. Fresh server activity is not required to reproduce the timing transition.

A second phased run logged GPU clock, package power, temperature, busy percentage, and JavaScript submission time. It introduced the discard controls before executing any batched draw or copying the envelope format:

| Stage on one frozen frame | Original predicate, ms | Rectangle branch, ms | No portal, ms |
| --- | ---: | ---: | ---: |
| minimal | 4.952 | 4.923 | 2.516 |
| zero-controls | 5.085 | 4.930 | 4.783 |
| batch-controls | 5.035 | 4.926 | 4.756 |
| minimal-again | 5.077 | 5.068 | 4.905 |

All 198 telemetry samples reported 800–904 MHz, with a median of 800 MHz; temperatures were 53–56°C. JavaScript submission of the 206 draws stayed around 0.1 ms per replay. There is no observed large sustained GPU clock drop matching the roughly twofold no-portal slowdown. Sampling was about 100 ms and is not an instruction-level power/occupancy trace; submission timing does not include all native driver CPU work.

The transition occurs before batched drawing or the R32F copy, so neither is necessary to trigger it. This was initially unresolved. The subsequent reduction below establishes direct CPU readbacks of the measured color target as the trigger and ties the tenth-readback boundary to the matching Mesa APU heuristic. It is a diagnostic artifact; no evidence shows that the production client’s particle target enters the same state.

The expanded batch prototype showed no useful GPU reduction, but it also changes the vertex addressing scheme and runs after the control shift. It does not establish that production batching cannot help. Likewise, the format and discard comparisons do not cleanly explain the original 2.4 ms gap. Do not combine their numbers with the initial control as though execution conditions were unchanged.

Across the six successful isolation sessions, 278 timing windows are retained. The first expanded attempt stopped because unused range-frame uniforms differed between draws. The corrected guard proves `uUsesRangeFrame == 0` for all captured particles and permits only those unread fields to vary. A telemetry script syntax error was corrected before launching that client. Failed attempts provide no accepted timings. All successful sessions disconnected after capture; no production renderer changes or visual acceptance checks were made.

Evidence: [same-frame phased measurements](evidence/world-particle-performance-2026-10-16/isolated-gles-phased-costs.json.gz), [same-frame telemetry](evidence/world-particle-performance-2026-10-16/isolated-gles-telemetry-costs.json.gz), [independent expanded run](evidence/world-particle-performance-2026-10-16/isolated-gles-expanded-costs.json.gz), [independent narrower run](evidence/world-particle-performance-2026-10-16/isolated-gles-narrow-costs.json.gz), [replay source archive](evidence/world-particle-performance-2026-10-16/isolated-diagnostic-probes.tar.gz).

The following readback/depth investigation completes that reduction. Historical expanded timings remain archived as contaminated measurements; use the corrected comparisons for conclusions about shader execution, batching, or envelope format.

## Readback resolution and fragment-depth candidate

### The tenth direct readback changes the timed color resource

The minimal reduction retains the original control programs while adding only duplicate copies of the same shader sources. The retained no-portal program still slows from 2.494 to 4.742 ms; adding new shader logic is not required. Fixing the material and canvas-emission selectors in shader source also fails to recover the fast timing in a target that has already crossed the readback threshold. These exploratory runs are retained, but are not accepted as clean optimization comparisons. In the duplicate-only capture, no-portal/copy-no-portal and the coordinate-only discard differ from the original at two pixels, with a maximum channel delta of 233. Those deliberately weakened visibility predicates are timing diagnostics, not correctness evidence. The corrected reconstruction captures below independently verify zero changed pixels.

Preparing each program set also performs several full-image comparisons. Separating those operations gives a reproducible boundary without creating additional shaders:

| Direct reads of the measured color target | No-portal GPU time, ms |
| --- | ---: |
| 6 | 2.514 |
| 7 | 2.556 |
| 8 | 2.555 |
| 9 | 2.517 |
| 10 | 4.764 |
| 11 | 4.744 |
| 12 | 4.775 |

Replacing only the color texture/framebuffer restores the no-portal time to 2.515–2.546 ms. Switching back to the old color target restores 4.772–4.783 ms. Three reordered fresh/old pairs share the **same depth texture, shader programs, mesh, particle records, draw order, camera uniforms, envelope, and background**. Every direct read matches the original captured image byte-for-byte. This isolates a resource-dependent effect, rather than a live-server scene change or a requirement for new shader code.

The official **Mesa 26.2.3** source archive contains the matching rule in `src/gallium/drivers/radeonsi/si_texture.c:2136–2144`, inside `si_texture_transfer_map`: on an APU, the tenth qualifying level-zero transfer of a non-depth/non-sparse texture requests in-place reallocation with `PIPE_BIND_LINEAR`. Both dimensions must be at least four pixels. The observed tenth-readback transition and fresh/old reversal match that heuristic. We did not trace the actual relocation/register writes. This is an intentional driver tradeoff for CPU transfer access, not a diagnosed driver defect. [Official Mesa source archive](https://archive.mesa3d.org/mesa-26.2.3.tar.xz); [matching release/source hashes and line references](evidence/world-particle-performance-2026-10-16/depth-driver-source-provenance.json).

The corrected harness copies rendered color into a **disposable RGBA8 framebuffer before each CPU read**. The measured color texture is never mapped for verification. It also reads background through a disposable copy and keeps one common reference image across setup changes. Copies and readbacks are outside GPU timing queries. This correction belongs to disposable diagnostics; production renderer source remains unchanged.

Evidence: [readback threshold and resource alternation](evidence/world-particle-performance-2026-10-16/depth-readback-trigger.json.gz), [duplicate-only reduction](evidence/world-particle-performance-2026-10-16/depth-reduction.json.gz), [contaminated fixed-material exploration](evidence/world-particle-performance-2026-10-16/depth-fixed-material.json.gz).

### Corrected controls narrow the real cost

With staged readbacks, five sequential program-set stages on the same frozen inputs keep no-portal GPU time around 2.55–2.69 ms. All five stages compare byte-for-byte against the original reference, retain 147,461 affected pixels, and report no GL error or extra live instanced submissions. The prior jump to 4.8 ms disappears.

The corrected controls still show no substantial benefit from removing all fragment discards, reducing the predicate to a direct envelope lookup, or sampling a copied R32F color envelope. The one-draw slot-remap batch prototype does not improve GPU time: normal 5.016 versus batched 4.967 ms, and no-portal 2.691 versus batched 2.877 ms. It also changes vertex addressing and does not establish the result of a differently packed production batch. These are now useful controls rather than comparisons against a readback-slowed target.

A fresh predicate experiment separates reading fragment Z from fetching the envelope. Each listed predicate produces exactly the same RGBA8 output in this captured view, but the cheap predicates are diagnostic substitutions, not generally correct visibility policies:

| Predicate | Median GPU time, ms |
| --- | ---: |
| Full original portal predicate | 4.964 |
| Portal code removed | 2.534 |
| Only `gl_FragCoord.x >= uAlphaTest` | 2.555 |
| Only `gl_FragCoord.z >= uAlphaTest` | 4.930 |
| Envelope texel positive; no fragment-Z input | 2.622 |
| Rectangle bypass plus envelope-positive test | 2.551 |
| Constant envelope texel positive | 2.545 |

Reading builtin fragment Z is sufficient to reproduce almost the whole expensive path. A spatial envelope fetch without Z costs only slightly more than no portal. This substantially narrows the earlier interpretation that per-pixel envelope memory traffic alone explains the gap. It does not yet establish the hardware reason for the fragment-Z penalty.

The matching Mesa source does not explicitly force LateZ just because a shader reads fragment Z: `gfx/si_state_shaders.cpp:1748–1759` selects depth order from early-fragment-test and memory-write properties. Native shader evidence also shows no fragment-depth export in either coordinate comparison. Therefore, do not equate this result with a proven loss of early depth testing.

Evidence: [corrected sequential controls](evidence/world-particle-performance-2026-10-16/depth-staged-readback.json.gz), [predicate isolation](evidence/world-particle-performance-2026-10-16/depth-predicates.json.gz), [readback/depth summary](evidence/world-particle-performance-2026-10-16/readback-depth-summary.json).

### Preserve the predicate and reconstruct its depth input

The diagnostic candidate adds two high-precision vertex outputs containing `gl_Position.zw`. The fragment stage reconstructs window depth as:

```glsl
windowDepth = 0.5 * (interpolatedClipZ / interpolatedClipW) + 0.5;
```

With ordinary perspective-correct interpolation, the shared perspective denominator cancels in that ratio, yielding the linearly interpolated NDC Z. The formula assumes the captured default depth range `[0, 1]`; the probe checks that assumption. The existing portal predicate still multiplies window depth by 0.5 for its envelope encoding. Metadata lookup, gutter handling, strict depth comparison, alpha test, material, blend/depth state, particle population, and draw count remain present. No distance/footprint reduction, lower-resolution pass, or outdoor visibility bypass is used.

This change is entirely in the app-local GPU shader layer. It supplies the same intended depth quantity through ordinary varyings instead of the builtin fragment-Z input. It does not change authoritative world/portal semantics or require shared-crate API changes.

| Frozen program | Median GPU time, ms |
| --- | ---: |
| Original full predicate | 5.042 |
| Full predicate with reconstructed depth | 2.682 |
| Rectangle branch with reconstructed depth | 2.597 |
| No-portal control | 2.573 |
| Builtin-Z-only test | 4.922 |
| Reconstructed-Z-only test | 2.595 |

All reconstructed-depth variants match the frozen original image exactly. Native optimized coordinate-test binaries corroborate the input change: the builtin version uses `SPI_PS_INPUT_ENA = 0x0402`, including `POS_Z_FLOAT`; the varying version uses `0x0002`. Both allocate 16 VGPRs, report a compiler maximum of 16 waves, use no scratch/spills, and have `SPI_SHADER_Z_FORMAT = 0`. The faster program is slightly larger, 296 versus 240 code bytes. These are compiler/configuration facts, not measurements of actual occupancy or hardware stalls.

Evidence: [depth-varying comparison](evidence/world-particle-performance-2026-10-16/depth-interpolated-depth.json.gz), [builtin coordinate native excerpt](evidence/world-particle-performance-2026-10-16/depth-native-coordinate-z-excerpt.txt), [varying coordinate native excerpt](evidence/world-particle-performance-2026-10-16/depth-native-interpolated-coordinate-z-excerpt.txt). The summary maps native source BLAKE3 keys to retained GLSL and records the matching release source paths. Asynchronous compiler logs can interleave; native creation records do not establish every runtime-selected cached binary.

### Live paired result and precision limits

The production frontend/release-host probe alternates original and depth-varying programs for all scoped world particles. Dedicated sky particles and other rendering programs remain unchanged. Five windows per mode use 1.5 seconds settling and 4 seconds measurement, with no V8 sampling or native dump flags. Both modes retain the same diagnostic frame-plan audit/uniform-forwarding overhead. The viewport is **1514 × 898** throughout; this differs slightly from earlier sessions, so compare within this run. Every measured frame retains exactly **206 dominant draws**.

| Live metric | Original | Depth varyings |
| --- | ---: | ---: |
| Particle GPU ms | 5.001 [4.905, 5.111] | 3.085 [3.058, 3.100] |
| Total measured GPU ms | 11.553 [11.439, 11.568] | 10.025 [9.806, 10.069] |
| Mean synchronous frame work, ms | 14.074 [13.610, 14.575] | 13.949 [13.364, 14.534] |
| Observed FPS | 55.528 [53.168, 56.909] | 56.454 [54.396, 58.516] |

Brackets are the range of the five window results, not confidence intervals. Particle GPU time falls by **1.916 ms (38.3%)**; total measured GPU time falls by **1.528 ms (13.2%)**. Observed FPS ranges overlap and the median changes modestly. This is useful GPU headroom, not evidence that the client is now CPU/GPU-budget complete or reliably at 60 FPS. Live mobs, simulation, streaming interests, and other particles can change between windows; paired ordering and a stable dominant population constrain that drift but do not eliminate it. Frozen comparisons provide the stricter causal evidence.

A separate native precision capture uses RGBA32F maximum blending to retain the worst encoded-depth discrepancy and any portal-predicate disagreement over all submitted fragments at each pixel. It repeats with ordinary scene-depth testing enabled and disabled, so occluded geometry is also exercised. Maximum absolute encoded-depth error is **1.1920928955078125e-7**; maximum positive/negative errors are **1.1920928955078125e-7 / 5.960464477539063e-8**. Both passes record **zero pixels with any portal-decision disagreement**, and the standard image comparison remains identical.

The arithmetic is equivalent in exact mathematics, but the measured rounding error is real. A strict portal-boundary comparison can differ on other geometry, especially coplanar/near-boundary content. No general error bound, indoor/door/window/near-clipping sweep, alternate depth-range support, moving-camera run, cross-device validation, or visual acceptance has been completed. This remains a promising diagnostic candidate, not a production cutover. The subsequent controlled boundary/precision fixture below fails this correctness gate. The earlier captured-scene equality remains valid, but does not justify production substitution. Do not hide the difference with an arbitrary epsilon or remove the existing portal checks.

Evidence: [live paired windows](evidence/world-particle-performance-2026-10-16/depth-live-interpolated.json.gz), [float precision/visibility proof](evidence/world-particle-performance-2026-10-16/depth-depth-precision.json.gz), [complete summary](evidence/world-particle-performance-2026-10-16/readback-depth-summary.json), [diagnostic source archive](evidence/world-particle-performance-2026-10-16/depth-diagnostic-probes.tar.gz).

The first predicate attempt failed shader compilation because its helper referenced existing material uniforms before their declarations; declarations were moved before the helper and the valid run is retained. No timings from that failed attempt are accepted. The readback/source download also encountered an incomplete local archive read before download completion; extraction succeeded after completion. No production renderer source was edited, all successful live sessions disconnected, and no further RenderDoc replay was attempted.

## Controlled portal-boundary validation

The user authorized the next correctness step before any production cutover. A standalone synthetic Electron fixture imports the current production visibility GLSL by resolving its source templates, records source hashes, and runs on the same **ANGLE / Radeon 780M / OpenGL ES 3.2** backend. It does not connect to the live server or consume game assets. Its layer is the app-local GPU shader contract: it isolates the portal predicate and its depth input rather than changing world semantics or particle admission.

The **96 × 80** fixture rasterizes a portal triangle into `DEPTH_COMPONENT24`, reduces its sampled depth by the production `* 0.5` expression into `DEPTH_COMPONENT32F`, and evaluates both original and reconstructed-depth predicates. Production metadata layout, screen/atlas lookup, strict comparison, and the two-texel gutter remain in use. A separate D24 scene attachment is cleared to 1; comparisons run with ordinary `LEQUAL` testing and depth writes disabled, then with testing disabled. The isolated reduction uses a depth-1 sentinel outside the triangle; it does not reproduce traversal/frontier routing or the full production reduction.

Nine geometry cases cover constant mid/far depth, sloping and perspective triangles, a large clip-W range, near/far clipping, an eye-plane crossing, and a steep narrow triangle. Three deterministic clip translations vary raster phase. Finite triangle and scissored-window envelopes are tested at eleven NDC-Z offsets from `-2^-16` through zero to `+2^-16`; unbounded and uncovered envelopes are controls. These translations are not a moving in-world camera test.

Each fresh process produces **1,296 comparisons** and **3,649,584 covered sample pairs**. Across **three fresh processes, all per-case numeric records repeat exactly**:

- **562 comparisons per run change visibility decisions**, totaling 324,856 differing sample decisions. These deliberately near-boundary cases are not an estimate of artifact frequency in the live scene.
- Relative to the original, 216,068 sample decisions become visible and 108,788 become hidden. The enabled/disabled scene-depth halves each contribute exactly half those totals.
- Coverage agrees at every sample. Unbounded and uncovered controls have zero decision differences.
- Maximum observed encoded-depth error is **9.566545486450195e-6**, larger than the earlier live-mesh maximum of `1.1920928955078125e-7`. Clipping/eye-crossing cases expose errors the captured outdoor mesh did not.
- Independent ordinary `discard` shaders writing RGBA8 reproduce **every** decision difference from the RGBA32F diagnostic outputs, with zero original/candidate mask discrepancies. The original discard program uses a vertex shader without the added varying. The failure is not an artifact of merely exporting a diagnostic boolean or depth value.

Representative finite-envelope cases, with scene depth testing enabled and no clip translation:

| Geometry / particle offset | Covered samples | Original accepts | Candidate accepts | Different decisions |
| --- | ---: | ---: | ---: | ---: |
| Constant mid-depth, particle `-2^-24` NDC Z in front | 3,309 | 3,309 | 0 | 3,309 |
| Sloping, exactly coplanar | 3,309 | 0 | 337 | 337 |
| Perspective, exactly coplanar | 3,309 | 0 | 2,130 | 2,130 |
| Near-clipped, exactly coplanar | 3,079 | 0 | 645 | 645 |
| Eye-plane crossing, exactly coplanar | 3,126 | 0 | 111 | 111 |

The simplest recorded counterexample is pixel `(2, 4)` in the constant mid-depth case. The portal envelope is `0.3125`. With a particle offset of `-2^-24`, the original encoded fragment depth is `0.3124999701976776`, so its strict comparison accepts. The candidate rounds to `0.3125`, so it rejects. Conversely, the coplanar sloping/perspective cases admit samples the original rejects. Thus algebraic equivalence in exact arithmetic does not preserve the current raster-depth/strict-comparison contract. No arbitrary epsilon, depth quantization guess, or replacement comparison was introduced.

**Disposition: reject direct clip-depth-varying substitution for production.** Its measured GPU saving and exact equality in the captured live scene remain useful evidence of avoidable dependency cost, but they do not establish a generally safe shader replacement. Matching arbitrary builtin-depth results across clipping, rasterization, and devices needs a proved approach; redesigning a shared envelope/deferred depth representation would be a broader renderer decision, not this local substitution.

Evidence: [boundary summary and first counterexample](evidence/world-particle-performance-2026-10-16/depth-boundary-summary.json), [run 1](evidence/world-particle-performance-2026-10-16/depth-boundary-run-1.json.gz), [run 2](evidence/world-particle-performance-2026-10-16/depth-boundary-run-2.json.gz), [run 3](evidence/world-particle-performance-2026-10-16/depth-boundary-run-3.json.gz), [complete standalone fixture source](evidence/world-particle-performance-2026-10-16/depth-boundary-probes.tar.gz). Repeated direct CPU readback is intentional here: no GPU timings are taken, and all correctness records repeat across fresh processes. No RenderDoc replay, production source edit, server mutation, or visual acceptance check was performed.

## CPU attribution and shadow-selection work

After the depth replacement failed its correctness gate, the user authorized CPU attribution. The production frontend and release host remain unchanged. A clean probe, without the particle shader/draw hooks, alternates the existing `shadow-maps` and `none` quality settings in one live session. Five pairs use V8 sampling at a requested 100 microseconds, followed by five pairs with V8 sampling disabled. Every window has 1.5 seconds settling and approximately 5 seconds measurement. Order reverses on alternating rounds. Renderer phase profiling remains enabled in both blocks; “without V8” does not mean all instrumentation is disabled.

The viewport remains **1519 × 904**, render scale 1, throughout the production run. The camera remains outdoors in `0x482dffff`. Mobs/animations and other particle populations remain live. The dominant population is verified separately in the count audit; this production timing run does not add a per-draw hook to prove 206 draws in every timed frame. Counts below therefore constrain workload drift rather than freeze it.

### Verified production comparison

The five windows per mode **without V8 sampling** give the following medians [minimum, maximum]:

| Metric | Shadow maps | Shadows off |
| --- | ---: | ---: |
| Synchronous frame work, ms | 13.297 [12.151, 13.567] | 9.648 [7.902, 9.961] |
| Renderer CPU, ms | 8.873 [8.071, 9.137] | 6.154 [5.088, 6.506] |
| Shadow preparation/submission CPU, ms | 1.758 [1.643, 1.815] | 0 |
| Scene contribution resolution CPU, ms | 2.528 [2.208, 2.611] | 2.014 [1.613, 2.157] |
| Total measured GPU, ms | 11.793 [11.512, 12.479] | 10.780 [10.237, 11.061] |
| Shadow-map GPU, ms | 0.091 [0.089, 0.093] | 0 |
| Observed FPS | 58.17 [55.87, 59.84] | 58.88 [58.58, 59.80] |

The median of the **five within-round mapped-minus-off differences** is 3.810 ms frame work, 2.857 ms renderer CPU, and 0.562 ms scene contribution resolution. These paired differences are not the same statistic as subtracting the two independent medians in the table. Per-pair visible dynamic entity count differs by -5 to +4, median zero; visible scene-entry count differs by -3 to +3, median zero.

Turning off shadows removes mapped selection/drawing, analytic fallback selection/evaluation, and receiver shader work. The 3.810 ms frame-work difference is the cost of that broader feature ablation in these windows, **not a promised saving from optimizing its selector**. GPU changes are also broader than the 0.091 ms shadow-map span: terrain receiver work changes and particle GPU timings vary. No GPU/CPU phase costs are added together. The near-60 FPS observation has overlapping ranges, so this experiment demonstrates frame-work headroom more clearly than a reliable displayed-FPS increase.

The V8-sampled block reports median frame work 14.482 / 11.252 ms and observed FPS 53.21 / 59.07 for mapped/off. Its sampling overhead changes available headroom, so the separate block without V8 carries the performance comparison. Diagnostic Python profile aggregation also ran during part of the V8 block and may overlap those windows; the later no-V8 block ran without that aggregation. Treat V8 results as function attribution rather than an uncontaminated benchmark of production speed.

### Function attribution

V8 stacks independently locate the work, rather than relying only on renderer bucket names. The analyzer matches zero-based call-frame locations to source bodies in SHA-256-identified production bundles, retains the mapping and source hashes, and normalizes each profile by its measured frame count. The first sample/delta includes a **366.929–774.953 ms** `Profiler.start` initialization gap; it is excluded from attributed sample totals and preserved in the raw profiles. Profile start/stop and bridge frame-count boundaries are close but not exactly coincident. These are estimates of renderer-main-thread attribution, not timings of Rust, workers, the compositor, or the GPU process.

With shadow maps, median inclusive sampled time per measured frame is:

| App-local function/path | Sampled ms/frame | Interpretation |
| --- | ---: | --- |
| Renderer scene contribution resolution | 2.638 | Dynamic ranges, footprints, descriptors, nameplates, and analytic shadow preparation share this path. |
| Renderer shadow preparation | 1.729 | Separate from ordinary scene assembly. |
| All-cascade shadow caster selection | 1.657 | Nested within shadow preparation; do not add it to its parent. |
| SceneGraph entry selection, all callers | 1.310 | About 0.689 ms is below shadow preparation. |
| RenderWorld contribution descriptor, all callers | 0.621 | About 0.273 ms is below shadow preparation; about 0.348 ms below ordinary assembly. |
| Object footprint projection | 0.294 | Approximately unchanged by disabling shadows. |
| Dynamic presentation publication | 1.388 | A separate runtime/publication lead outside renderer scene assembly. |

Costs overlap through parent/child stacks. Compiler inlining and minified symbol attribution also limit conclusions about individual tiny leaf functions. The descriptor cost must not be called “time spent cloning matrices”: its implementation performs classification/lookups and constructs the whole descriptor as well. The count audit below establishes that copies happen; it does not isolate their exact time.

### Count-only audit: gloom effects also burden shadow selection

A separate Vite-development/release-host probe wraps the exported renderer, scene graph, RenderWorld, shadow pass, particle system, and matrix methods. It records **300 frames with shadows off** and **300 with shadow maps**, without using those instrumented frames as timing evidence. The development sessions have slightly different viewports, 1520 × 905 and 1521 × 906, and live entity counts. The mapped audit has renderer phase profiling enabled so its selected-caster workload is also retained; the off audit does not. These differences preclude treating them as a development performance pair.

Every mapped-audit frame contains all **206 distinct owners** of mesh `0x01003fa7`. All 206 appear in **each of the two cascade query results**. Across frames, those queries return 256–259 and 366–369 roots. The union has median 366 roots: **302 `other`, 59 mobs, four NPCs, and one player**. Only the last three classes are eligible under the existing shadow policy. Thus about **82.5%** of the returned unique roots are rejected by class after the scene query; this includes every dominant gloom owner.

The collector unions cascade memberships before creating descriptors, so each gloom owner receives **one** descriptor during shadow preparation, then another during ordinary color assembly. It does not create two shadow descriptors merely because two cascades select that owner. Every frame records 206 dominant-owner descriptors in each phase.

Median matrix clone counts within one renderer frame are **366 in shadow descriptors**, **337 in ordinary contribution descriptors**, and **397 elsewhere in rendering**. The gloom population alone contributes 206 copied placements in each descriptor phase. The off audit has no shadow descriptors, 337 ordinary descriptor clones, and 367 elsewhere. These are counts, not a claim that all copies can be eliminated or that their byte volume explains the timing difference.

The mapped audit's existing shadow metrics retain **64 eligible candidates**, with **eight mapped roots**, **24 analytic roots**, and **32 budget-rejected roots**; two cascades select 15 depth draws and 171 part/cascade memberships. The expensive preparation is not caused by hundreds of mapped casters actually being drawn.

Source evidence explains the counts:

- [Dynamic root publication](../../apps/holtburger-3d/src/lib/game/systems/dynamic-entity-placement-system.ts) assigns every root to the same `dynamic` culling group, including non-caster effects.
- [Shadow caster selection](../../apps/holtburger-3d/src/lib/game/renderer/outdoor-pssm-casters.ts) queries that group for each cascade, unions roots, constructs contribution descriptors, and only then checks the producer-resolved entity class.
- [RenderWorld descriptors](../../apps/holtburger-3d/src/lib/game/renderer/render-world.ts) obtain dynamic placements through `getResolvedPlacement`; static footprints use `getResolvedBounds`.
- [SceneGraph](../../apps/holtburger-3d/src/lib/game/scene/scene-graph.ts) explicitly defines those methods as copying inspection APIs. It already exposes `readResolvedState` for synchronous borrowing, with a no-mutation/no-retention-across-scene-mutations contract. A production borrow change must prove consumer lifetimes rather than globally weaken the copying APIs.

**Next implementation candidate:** make producer-resolved actor eligibility available before shadow broad-phase traversal and descriptor construction. A class-specific dynamic query partition is one possible app-local scene/renderer design; inspect all culling-group consumers and ownership before choosing it. Keep the actor eligibility decision with frontend shadow policy, and preserve ordinary color visibility, conservative particle bounds, portal-domain membership, complete-root geometry, and selected actor/cascade/budget results. Validate identical selected roots, cascade masks, depth spans, and pose-liveness inputs at fixed poses, then measure repeated production windows. No shadow-preserving saving from that candidate has yet been measured. Do not claim the entire 1.758 ms shadow bucket is removable.

Borrowing frame-local placement facts is a separate, narrower opportunity. It requires auditing retained compiled/static submissions and mutation boundaries; no cache or borrow substitution has been introduced here. All of this remains in the app-local browser presentation/scene/renderer layers and requires no shared Rust world/protocol change.

### Probe failures and cleanup

Preparation initially used an invalid shadow enum, then retained select elements after the Settings window destroyed them on close. Those attempts are excluded. The valid timing probe reacquires connected controls each time and checks active shadow target bytes before accepting a window; `none` must release them and `shadow-maps` must allocate them. Six mislabeled windows from the detached-control attempt and one baseline from a rejected preflight are not retained as accepted comparisons.

The timing probe restored the UI setting but exited before its debounced preference write completed. The first count audit consequently observed shadows off. The subsequent mapped audit explicitly saved the original `shadow-maps` mode and verified both persisted mode and **8,388,608 active target bytes** before collecting its 300 frames. Original settings are now restored. The archive retains the exact timing-capture source and a second version with persistent restoration for future runs; only that cleanup differs, and the amended cleanup was not rerun as a timing capture. No production code was edited, all sessions exited, no TUI was run, and no visual acceptance check was performed.

Evidence: [CPU summary, per-profile attribution, compiler/source hashes, and count summaries](evidence/world-particle-performance-2026-10-16/cpu-shadow-summary.json), [20 production windows](evidence/world-particle-performance-2026-10-16/cpu-shadow-trials.json.gz), [mapped count audit](evidence/world-particle-performance-2026-10-16/cpu-work-audit-mapped.json.gz), [off count audit](evidence/world-particle-performance-2026-10-16/cpu-work-audit-none.json.gz), and [probe/analyzer/validator sources](evidence/world-particle-performance-2026-10-16/cpu-diagnostic-probes.tar.gz). The summary names all ten retained compressed V8 profiles.

## Scoped fix: reject non-casters before per-node shadow culling

Status: **Implemented and verified after the user's subsequent go-ahead.** The design below records the scope chosen after tracing producer updates, query consumers, and ordering. The measured implementation result follows this section.

### Goal and chosen boundary

Exclude roots whose current presentation class cannot cast shadows before their individual frustum tests, cascade-membership accumulation, and contribution descriptor construction. Preserve the existing actor shadows and ordinary scene/particle rendering. Keep this change in the app-local scene-query and renderer layers.

The narrow first implementation should use the existing `dynamic` group and add a synchronous per-node predicate to the scoped scene query. **Do not split the scene index by presentation class in this change.** That alternative has two concrete costs:

- `DynamicEntitySystem.stageVisualReplacement` can assign a new `entity.source` at commit without replacing the root. The compatibility check does not require an unchanged entity class. A published class partition would therefore require an additional atomic reindexing contract, not just a tag at root creation.
- Scene queries traverse culling groups in insertion order. Splitting one group can reorder ordinary contributions, while far transparent cohorts in `object-rendering-policy.ts` explicitly preserve first-seen order. Returning the same set of nodes would not alone prove unchanged color rendering.

A node predicate reads the current producer-owned class through the existing `DynamicEntitySystem.getPresentationClass` port, preserves traversal order, and adds no retained eligibility state or invalidation mechanism. It costs a cheap class lookup for each node visited by the shadow query. The shared query loop also gains a nullable-predicate branch; verify ordinary rendering and a shadows-off control for regressions. It still visits non-caster IDs and still pays existing group-level aggregate-bounds work. Those are accepted limits of the first fix; further indexing changes require residual profiling evidence.

### Contract and ownership

The proposed flow is:

```text
Renderer shadow pass
  -> RenderWorld.queryOutdoorShadowCasters(frustum, anchor)
     -> SceneGraph.queryScopesFrustum(outdoor, dynamic group, node predicate)
        -> existing group bounds
        -> current class eligibility
        -> retained node's individual frustum test
  -> existing cascade union, actor facts, budgets, and depth preparation
```

`SceneGraph` owns execution of a generic, side-effect-free `SceneNodeFilter`; it knows nothing about entity classes or shadows. The predicate is stable for the duration of one synchronous query and must not mutate the graph or issue nested queries because result storage is reused. Other query paths explicitly pass no node filter and retain their existing behavior.

`RenderWorld`, already in the renderer layer, owns the narrowed query policy: outdoor scope, dynamic producer group, and the existing `isEntityShadowCasterClass` rule. Capture one stable predicate per RenderWorld instance rather than allocating closures per cascade. A missing dynamic presentation class rejects a node, matching the existing inability to obtain a dynamic contribution; this is not a new fallback for a valid caster.

The scoped `RenderWorld.queryScopesScene` wrapper has only one production consumer: outdoor shadow selection, reached through the WebGL2 renderer's adapter. Replace that wrapper with the specifically named `queryOutdoorShadowCasters(frustum, anchor)`. The selector no longer supplies arbitrary scopes/group policy and no longer re-evaluates class eligibility after constructing a descriptor. Existing dynamic-contribution availability, plural outdoor membership, depth render-scope, complete-root geometry, and mapped/analytic budget checks remain in their current owners.

No new class tag, shadow bit, cache, second spatial index, renderer setting, permanent benchmark switch, or shared Rust API is required. The current class predicate remains the policy source for both the narrow query and existing analytic-grounding consumers.

### Production surface and expected size

| File | Scoped change |
| --- | --- |
| `src/lib/game/scene/index.ts` | Define/comment the generic node-predicate contract. |
| `src/lib/game/scene/scene-graph.ts` | Accept an explicit nullable node predicate on scoped queries; apply it before per-entry bounds tests; existing flat/scope-selection paths pass no predicate. |
| `src/lib/game/renderer/render-world.ts` | Replace the generic shadow-only wrapper with `queryOutdoorShadowCasters`; bind the current-class predicate using the existing systems port. |
| `src/lib/game/renderer/outdoor-pssm-casters.ts` | Consume the narrow query; remove the old dynamic-group helper/constants and late class rejection. Preserve all subsequent scope, geometry, ordering, and budget behavior. |
| `src/lib/game/renderer/webgl2-renderer.ts` | Update the existing shadow-world adapter to the narrowed method. |

The scope estimated roughly 30–60 net production lines across those five files, plus focused tests and diagnostic evidence. The completed implementation is smaller: **44 additions and 34 deletions, ten net production lines**, with no new production file, index migration, or lifecycle state.

### Implementation and acceptance

1. **Narrow the query contract and wire it through.** Make the node filter explicit rather than using an implicit default. Update direct scoped-query callers and test doubles. Keep general scene-query order and reused-buffer lifetime intact; no class parsing or policy enters SceneGraph. Remove the superseded RenderWorld wrapper and selector vocabulary in the same cutover.
2. **Prove selection equivalence with fixed input.** Extend existing scene-query, RenderWorld, shadow-caster, and PSSM-pass tests. Use a real SceneGraph in the integration case: giant `other` effects mixed with player/NPC/mob roots, portal-class roots, overlapping cascades, off-camera casters, indoor-only and plural outdoor/indoor membership, empty depth geometry, and constrained mapped/analytic budgets. Compare the new query against a test-owned reference that queries the same unchanged world without the node predicate and filters by the existing class rule afterwards. Require identical ordered eligible roots, cascade masks, selected depth spans, analytic assignments, and pose-liveness node identities. Change a root's current class between queries, and cover staged replacement commit/cancel/failure where relevant; results must follow committed source state without an index update.
3. **Verify the runtime and measure the narrower workload.** Run the canonical hardware-GPU outdoor PSSM fixture and retain numeric output. Repeat at least five controlled production baseline/candidate windows at the same camera and quality, with workloads and ranges recorded. Use deterministic fixed-pose evidence for equivalence; live mobs are not a correctness oracle. Do not run heavy analysis/builds during timing windows. Repeat the count audit: none of the 206 dominant owners should reach shadow query output, membership maps, descriptors, or copied placements; ordinary color/particle admission must remain intact. In the recorded fixed workload, the shadow union should contain the same 64 eligible actors instead of about 366 mixed roots, with the same eight mapped, 24 analytic, and 32 budget-rejected candidates.
4. **Clean up and record the result.** Run focused TypeScript tests, app type checks, TypeScript lint/dead-code checks, and formatting for touched files. Remove temporary profiling controls and the old wrapper/helper vocabulary; keep accepted evidence in this investigation. Restore and verify saved user settings and close diagnostic clients. Visual acceptance remains with the user.

The existing test files most directly affected are `scene/index.test.ts`, `renderer/render-world.test.ts`, `renderer/outdoor-pssm-casters.test.ts`, and `renderer/webgl2-outdoor-pssm-pass.test.ts`. Adapt the tests to the narrower contract rather than retaining mocks that return ineligible roots from an eligible-only query. Test the eligibility seam through real producer class data, not just an independently hand-built ideal list.

Recommended existing checks from `apps/holtburger-3d` are `npm run test:ts -- <focused test paths>`, `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run harness:browser -- --fixture outdoor-pssm --gpu --brief`. Use a frozen synthetic comparison for actor identities/order and a fresh production build for timing; do not compare Vite development timings against production numbers.

### Expected benefit, limits, and deferred work

The measured opportunity spans part of roughly 0.689 ms/frame of sampled shadow scene selection and 0.273 ms/frame of sampled shadow descriptor work, plus non-caster membership-map work. These V8 values are attribution estimates under sampling overhead, not a predicted saving. In the current workload, the change should avoid 412 dominant-owner per-node cascade tests and 206 dominant-owner shadow descriptors/placement copies per frame. It does not avoid the cheap new class lookups or aggregate group-bounds work.

There is **no FPS or millisecond promise before benchmarking**. The 1.758 ms shadow CPU bucket includes retained work; the broader shadows-off experiment also changes analytic evaluation and receiver shaders. This CPU fix does not reduce the particle fragment shader's approximately 5 ms GPU workload.

Transform borrowing, class-partitioned spatial indexes, particle distance/footprint admission, the rejected reconstructed-depth shader, lower-resolution particles, and shadow quality/budget tuning remain separate work. No ACE, protocol, shared-world, retail-decompile, or visual-acceptance changes belong in this fix.

The scope review traced dynamic-root creation, source replacement/commit, scene grouping/query order, RenderWorld forwarding, the shadow adapter/collector, and far transparency's first-seen ordering. The following implementation evidence addresses those acceptance gates; movement, streaming, cross-device performance, and user visual acceptance remain outside this stationary investigation.

## Implemented early shadow eligibility

The implementation follows the scoped boundary. `SceneGraph` accepts an explicit nullable generic node predicate and applies it before individual bounds tests. `RenderWorld.queryOutdoorShadowCasters` supplies the existing outdoor/dynamic selection and current presentation-class rule through one stable predicate. The collector consumes that narrower result and removes the old late class rejection. Ordinary color queries pass no predicate. Group ordering, aggregate bounds, subsequent scope and geometry checks, budgets, and animation liveness remain in their existing owners. There is no class index, eligibility cache, additional lifecycle state, quality control, or production diagnostic switch.

### Correctness and runtime checks

- **90 focused tests passed across five files.** A real SceneGraph/RenderWorld/collector integration compares ordered mapped geometry, parts, analytic shapes, and selected animation roots with an unfiltered reference using the former class policy. It covers overlapping cascades, off-camera actors, large non-casters, plural outdoor/indoor membership, empty depth geometry, and several budgets. Scene tests cover order and reused result storage. A real DynamicEntitySystem test covers staged class replacement cancel/commit; current-class queries need no reindexing.
- **30 same-frame live preparations matched exactly.** Each prepares the original and optimized paths synchronously on unchanged frame input, comparing complete serialized cascade inputs, ordered geometry/parts, analytic output, candidate masks, and animation-liveness identities. The retained hashes label those comparisons; acceptance used complete string equality. The scene had 63 eligible candidates, eight mapped roots, 24 analytic roots, and 31 budget-rejected roots in this capture. Earlier audits had 64 candidates: live populations change.
- **Hardware-GPU PSSM fixture passed.** Caster, grounding, and receiver programs linked; target creation, resizing, reuse, disposal, and the posed-depth pixel checks passed. Its Chrome ANGLE Vulkan backend differs from the native Electron GLES backend used for live proofs and timing. This fixture verifies GPU execution and resource behavior; the actor-selection proof comes from the integration and same-frame comparisons.
- **Type checks, TypeScript lint, dead-code lint, touched-file formatting, production build, and whitespace checks passed.** A fresh ordinary production build was also exercised without diagnostic globals or prototype hooks. Saved mapped-shadow preferences were restored and verified, and diagnostic clients disconnected. Visual acceptance remains with the user.

### Controlled measurement and removed work

The final comparison uses a disposable production-minified build with the original HEAD scene-selection loop inserted as a private diagnostic method. Baseline mode uses that loop, unfiltered shadow results, and the original class rejection after full descriptor construction. Candidate mode uses the implemented early filter. Both have the same fixed prototype wrappers. Counter/owner hooks are removed before timing; no V8 sampling, image readback, builds, or heavy analysis runs during measurement windows. Five alternating pairs per setting use 1.5 seconds of settling and five seconds of capture. Each row reports the median of five window snapshots and their minimum–maximum.

| Mapped shadows enabled | Original path, ms | Early eligibility, ms |
| --- | ---: | ---: |
| Shadow CPU preparation/submission | **1.741 [1.698–1.855]** | **1.197 [1.173–1.218]** |
| Total renderer CPU | 8.866 [8.664–9.413] | 8.489 [8.234–8.589] |
| Synchronous frame work | 13.347 [12.984–13.930] | 12.847 [12.426–13.161] |
| Measured GPU phase sum | 11.453 [11.219–11.545] | 11.314 [11.191–11.501] |

The approximately **0.544 ms difference between shadow CPU medians** is the most direct result. All five pairs improve that phase; paired savings have a median of **0.566 ms [0.514–0.658]**. Total frame-work and renderer deltas include unrelated live work; they are not a guaranteed end-to-end improvement. The unchanged GPU workload is a control, not a GPU optimization claim. Visible dynamic counts were 298–299 during these windows.

Separate two-second count audits found 206 dominant effect owners in both modes. Baseline returned all 206 in each cascade and constructed 206 dominant-owner descriptors with copied placements per preparation. Candidate returned **zero** of those owners to shadow selection and constructed **zero** non-caster shadow descriptors. Total descriptors/copies fell from approximately 364 to 63 per preparation; actor counts can drift between audits. Cheap class lookups and aggregate group-bounds work remain.

Five additional pairs with shadows disabled compare the original and current shared scene loops without the shadow workload. Shadow CPU time is zero in both; frame-work medians are 9.648 / 9.209 ms, with overlapping ranges and one reversed pair. This supports no consistent regression from the nullable-predicate branch; it does not establish a separate ordinary-rendering speedup. An earlier ten-window pilot also found savings but used the new shared loop with a null filter as its baseline; it is retained separately and excluded from the final table.

The final ordinary production smoke uses five four-second windows on the original GLES backend, after a normal build, and confirms the temporary class globals are absent and mapped shadows remain enabled. Its 304–308 visible dynamic roots differ from the paired workload: shadow CPU is 1.361 ms [1.261–1.432], frame work 14.102 ms [13.528–14.404], and particle GPU time 5.297 ms [5.236–5.516]. It is a separate live session, so these timings must not be subtracted from the paired baseline. The first diagnostic original-loop build attempt failed because the transform expected TypeScript syntax after Vite had already stripped it; the stale launch was stopped and contributed no accepted timing. The corrected transform checks a build marker before capture.

Evidence: [implementation summary and full ranges](evidence/world-particle-performance-2026-10-16/shadow-filter-summary.json), [complete production/test patch](evidence/world-particle-performance-2026-10-16/shadow-filter-change.patch), and the paired/control, pilot, production-smoke, GPU-fixture, and disposable-source entries in the [manifest](evidence/world-particle-performance-2026-10-16/manifest.json).

The final quality review traced the producer class accessor through RenderWorld, SceneGraph, the WebGL2 adapter, and the collector; it also reviewed current-class replacement, query borrowing/order, the independent reference, and the removed wrapper vocabulary. Class policy remains renderer-owned and generic culling remains scene-owned. The accepted trade-off is visiting non-caster IDs for a cheap lookup rather than adding a synchronized index. No blocking design or correctness issue was found within that boundary. Transform borrowing and the residual GPU cost remain separate opportunities.

## Broader audit of work performed before admission

Status: **Source audit, six live count windows, 30 timing windows, and frozen composition checks completed on 2026-10-16. Production code unchanged during this follow-up.** The audit asks whether consumer-specific eligibility is decided after expensive preparation or copying, rather than assuming every late check is wasteful. Cheap rules belong to the renderer policy that owns them; generic scene queries should execute supplied admission without learning shadow or UI semantics.

### Confirmed second instance in grounding preparation

In [`webgl2-renderer.ts`](../../apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts), the ordinary contribution path enters the grounding block when shadows are enabled and color ranges survive. It fetches shadow facts, resolves indoor/outdoor membership, and may call `DynamicDepthPreparations.prepare`. Only afterwards does [`resolveEntityShadowCaster`](../../apps/holtburger-3d/src/lib/game/renderer/entity-grounding.ts) reject a non-caster presentation class. That resolver's first operation is the existing class predicate, before reading placement, bounds, identity, or membership. Non-caster depth preparation cannot contribute to its result.

The opportunity differs by mode:

- **Simple outdoor shadows:** outdoor roots request depth preparation before class rejection. A two-second live count audit found **249 non-caster depth preparations per frame**, all cache misses and all nonempty. None produced a caster. **192 requests per frame belonged to the dominant gloom owners**, out of 206 owners still present in ordinary rendering.
- **Mapped outdoor shadows:** the ordinary path fetched facts for approximately 250 non-casters per frame in this stationary outdoor view, but requested no grounding depth for them. The earlier mapped-shadow query fix already removed their independent cascade work. An earlier class check here would avoid facts/membership work, not another 249 depth preparations in this mode.
- **Indoor membership:** the same code requests depth before class rejection when a root reaches an EnvCell. This is a source-confirmed ordering issue; this capture has no indoor requests and does not measure a live indoor scene.
- **Shadows disabled:** the grounding block is already skipped. This supplies a control for unrelated scene/timing variation.

These are total counts divided by each audit's own frame count, not medians of repeated count captures. Baseline simple mode had 116 frames and 28,884 non-caster preparations; early admission had 113 frames and zero non-caster preparations. Both retained 17 visible mob casters and one player caster per frame. Live populations and fades can change: 206 effect owners do not imply 206 depth-eligible color roots in every frame.

The disposable candidate checks the already-carried contribution class at the grounding block entrance. It changes no scene queries, bounds, budgets, geometry policy, shaders, or quality values. Six count windows cover baseline/early admission under mapped, simple, and disabled shadows. Counter hooks were removed before timing; a production-minified diagnostic build then ran five alternating pairs per mode, with 1.5 seconds of settling and four seconds of capture. No V8 sampling, image readback, builds, or heavy analysis ran during those windows. The build retains the same mode condition and disabled count callbacks in both variants; it is an experiment, not a shipping optimization.

### Timing result and correctness boundary

The measured CPU phase is ordinary scene-contribution resolution, which contains this grounding block. It is distinct from the outdoor shadow-map CPU bucket optimized earlier. Each value below is the median of five window snapshots, with minimum–maximum in brackets. The last column is the median of paired baseline-minus-early differences, with its own range; it need not equal the difference between the first two medians.

| Shadow mode | Baseline scene CPU, ms | Early admission scene CPU, ms | Paired saving, ms |
| --- | ---: | ---: | ---: |
| Simple | 3.080 [2.739–3.422] | 2.958 [2.685–3.026] | **0.197 [-0.276–0.403]**, positive in 4/5 pairs |
| Mapped | 2.706 [2.619–2.770] | 2.792 [2.373–2.869] | -0.022 [-0.250–0.333], positive in 2/5 pairs |
| Disabled control | 2.215 [2.032–2.452] | 2.424 [2.074–2.693] | -0.064 [-0.295–0.038], positive in 1/5 pairs |

The counts establish removable work. Simple mode supplies a modest CPU-phase lead, but **no end-to-end gain is demonstrated**: its frame-work medians are 11.523 [10.276–12.199] / 12.010 [11.360–12.306] ms, and the paired frame-work difference is -0.022 [-1.733–0.162] ms. Observed throughput stays near 60 Hz. The disabled control runs the same grounding code path in both variants yet varies materially, and even the unchanged GPU workload varies. Visible dynamic populations span 298–304 across the timing run. These results do not support treating this as another proven 0.54 ms improvement or as a measured cause of the remaining mapped-mode cost.

A frozen fixture composes the real index-batch compiler, material-free depth preparer, and grounding resolver. All **150 combinations** preserve serialized caster output under early class admission: five classes, outdoor/indoor/plural membership, five geometry states, and both retail-hidden debug policies. The geometry states cover opaque spans, transparency, zero opacity, degrade-hidden geometry, and empty appearance, with multiple part selectors and culling spans. Of the 100 cases reaching indoor membership, 18 produce nonempty indoor caster output, so equality is not established only through null results. A non-caster input with throwing getters also proves the resolver reads no other facts before rejecting its class.

This is a fixed composition proof, not full renderer/cascade/animation-liveness or GPU equivalence. Before shipping a change, add focused renderer integration coverage and repeat a same-frame full-output comparison; the earlier fix's 30 live proofs apply to its query change, not to this separate candidate. No live indoor scene, movement, streaming, or visual acceptance was exercised here.

### A broader mismatch in the same analytic path

The grounding block uses the depth result only as `depth !== null`. The resolved analytic caster uses rigid bounds and root placement; it does not consume prepared depth spans, selected parts, triangle counts, appearance resources, or geometry identity. Nevertheless, [`DynamicDepthPreparations`](../../apps/holtburger-3d/src/lib/game/renderer/dynamic-depth-preparation.ts) walks physical ranges, coalesces spans, tracks distinct parts, and counts triangles to produce that complete result.

This is a confirmed mismatch between the consumer's boolean geometry-admission need and the full drawing representation it requests. After early class admission, the simple-mode audit still prepares full depth for 18 actors per frame; those preparations return roughly 195 selected part memberships per frame. Those are CPU preparation/output counts, not extra GPU draws, uploads, or a measured time saving. The narrower geometry-presence alternative has not been implemented or benchmarked.

A follow-up design should first consider whether an existing preparation owner can answer “has eligible opaque geometry” without constructing depth submission spans. Preserve preparing/hidden/no-draw behavior, opacity, ordering, retail-hidden policy, and useful depth-cache reuse. Share the eligibility rule at its owning renderer-preparation layer rather than copying the range predicate into grounding. An early-return search must not accidentally remove a required invariant check on later ranges; establish what the staged appearance contract guarantees before choosing that design. Keep full depth preparation for mapped draws and selection masks, whose consumers actually require it. The scope below resolves this choice by reusing the existing ordinary source-range walk, eliminating the need for an additional presence query.

### Related candidates and cases that already admit early

| Path and layer | Source finding | Interpretation and next evidence |
| --- | --- | --- |
| Ordinary contribution descriptors, renderer/scene boundary | The renderer obtains a descriptor before its projected-footprint check. Dynamic descriptors call copied-placement access; static footprints copy bounds and placement. | Copying is confirmed; avoidability and cost remain unproved. Footprint tests need the facts but may only need a synchronous borrow. Audit retained compiled submissions and inspection lifetimes before changing the contract. Earlier count evidence found 337 ordinary descriptor matrix copies in its separate workload. |
| Dynamic presentation publication, frontend runtime/renderer boundary | Hidden/preparing entities return before part-matrix composition. The renderer also shares one publication per root across frame consumers. | Existing early checks and frame reuse reduce work. Do not claim repeated per-pass composition merely because multiple consumers request it. |
| Particle simulation and range collection, frontend runtime | Hidden emitters stop before frame/emission work; draw-owner admission precedes following-frame updates and range construction. | Existing early admission. The dominant effect owners are admitted by current visibility policy; changing distance/footprint policy is a separate question. |
| Nameplate rendering, renderer | Legibility/count selection precedes text rasterization and GPU texture acquisition. Population reconciliation is revision-driven. | Textures are already demand-created. Icon sources are prepared for the installed population on revision changes, so that cold ownership policy should not be described as per-frame text preparation. |
| Mapped shadow geometry, renderer | Root candidates are ranked and budgeted before material-free depth preparation. | Bounds and distance are needed to rank roots. Moving every decision ahead of all preparation would be incorrect; reject cheaply only when the necessary facts are already available. |

The audit therefore supports recurring **late admission and requests for richer data than the consumer uses at specific boundaries**, rather than a blanket renderer failure. The grounding block is the next confirmed instance; its measured priority is lower than the first fix for the current mapped outdoor scene. Transform borrowing is a separate API/lifetime investigation. No global “visible entity” bit or class-partitioned index is warranted by this evidence: color, shadow, particle, and interaction consumers have different admission rules.

Evidence: [broader audit summary and complete ranges](evidence/world-particle-performance-2026-10-16/late-admission-summary.json), sanitized live trial/count captures, the frozen fixture results, and disposable build/probe/fixture/validator sources in the [manifest](evidence/world-particle-performance-2026-10-16/manifest.json). The diagnostic client restored and persisted the original mapped-shadow settings, restored counter hooks, and disconnected. The production/test patch hash exactly matches the completed first fix; this follow-up adds documentation/evidence only.

## Scoped follow-up fixes

Status: **Both follow-ups implemented and validated after the user's go-ahead on 2026-10-16.** The scope below records the chosen boundaries and acceptance gates. Keep analytic grounding admission separate from renderer borrowing with explicit ownership at static compilation. Both remain inside `apps/holtburger-3d`; no shared Rust API, protocol, content format, quality setting, shader, particle cutoff, or class index changes are needed. The first completed shadow-query optimization remains the baseline.

### Fix 1 — derive grounding admission during the existing range walk

**Goal:** reject non-caster classes before fetching grounding facts, and stop constructing depth submissions solely to establish geometry presence.

The scope is smaller than adding a `hasShadowGeometry` query to `DynamicDepthPreparations`. The ordinary contribution path already walks every logical appearance range to compute its retained source-range count, before entering grounding. `compileDynamicIndexBatches` preserves those source-range records in its physical plan, and `WebGL2DynamicAppearances` is empty exactly when the source appearance has no ranges. Grounding can therefore consume an exact eligibility fact produced during that existing walk. No second scan, eligibility map, depth-cache entry, or per-range object is required.

The renderer's per-root admission result should carry both existing retained source-range count and a commented `hasMaterialFreeShadowGeometry` boolean. Keep these related facts together in the current frame-preparation record; use the existing per-root target allocation where practical. An unavailable/hidden/preparing publication produces explicit zero/false admission. Source count remains the owner of existing range metrics and nameplate admission; the new boolean is consumed by grounding only.

The boolean means that at least one source range passes the **existing material-free shadow rule**: authored ordering is `opaque`, current part opacity is nonzero, and retail visibility is retained under the frame's debug policy. It does not mean that the color opaque-pass span list is nonempty:

- Color's opaque phase includes `alpha-test`; material-free shadow depth excludes it.
- A partially faded authored opaque range moves to transparent color drawing, but current shadow preparation retains it while opacity is nonzero.
- Transparent/additive authored ranges, zero-opacity parts, and hidden retail ranges remain excluded exactly as today. Do not add a new triangle-count or index-count threshold.

Put that scalar rule in one small shared renderer-policy predicate, colocated with existing dynamic range policy or depth preparation. Both the existing depth builder and the ordinary source-range summary use it. Keep the existing part-selector checks in their loops and complete the ordinary range walk even after the boolean becomes true; a valid earlier range must not suppress an error for a missing later part. Selection masks retain their deliberately different opacity/ordering behavior.

The resulting renderer-layer flow is:

```text
Existing dynamic publication and source-range walk
  -> retained source-range count + exact material-free geometry admission
  -> existing color submissions
  -> shadow mode enabled + actor class + geometry admitted?
     -> grounding facts and required indoor/simple-outdoor domain check
     -> rigid proxy construction and existing receiver selection
```

At grounding entry, apply `isEntityShadowCasterClass` before `getEntityShadowDynamicFacts`. Use the already-carried geometry boolean, preserve the indoor-versus-simple-outdoor domain condition, and delete the grounding call to `DynamicDepthPreparations.prepare`. Full depth preparation remains for mapped caster draws and selection masks. Merely moving the class check while retaining the redundant actor depth query would leave the representation mismatch unresolved.

`resolveEntityShadowCaster` has one production caller, this block. Narrow it to resolving an already-admitted actor's geometry: remove its `entityClass` input, late class test, and unused class-policy imports. Keep its scope/island, finite dimension, rigid bounds, and root-contact checks. The renderer owns class admission once; the resolver owns proxy geometry. Move class-rejection coverage to the policy/renderer boundary and update geometry fixtures instead of preserving a second class decision through tests.

| Production file | Change |
| --- | --- |
| `renderer/webgl2-renderer.ts` | Carry the two admission facts from the existing range walk, gate grounding early, remove its depth request, and preserve downstream shape/liveness/color behavior. |
| `renderer/dynamic-depth-preparation.ts` | Consume the shared exact shadow-range predicate; retain full preparation for actual depth/mask consumers and all existing cache/storage semantics. |
| `renderer/object-rendering-policy.ts`, if chosen as the shared predicate's owner | Colocate the pure range-admission rule with existing dynamic phase policy; do not use `dynamicObjectPhase` as the shadow rule. Keep the predicate in an existing renderer module. |
| `renderer/entity-grounding.ts` | Remove class policy and the superseded input field from the geometry resolver. |

Expect roughly **flat to 60 net production lines across three or four existing files**, chiefly a small commented admission contract and shared predicate offset by removed depth/class plumbing. No new production file should be required. A second iterator framework, new cache, broad geometry-summary subsystem, or larger lifecycle contract would exceed this scope.

Acceptance and implementation sequence:

1. **Share the predicate and carry the fact.** Extend existing dynamic-depth/policy tests with actual compiled source/physical plans. Require the carried geometry boolean to equal the baseline `prepare(...) !== null` result across mixed authored orderings, alpha-test-only roots, partial/zero opacity, empty appearances, both retail-hidden modes, and appearance replacement. Include an eligible first range followed by an invalid part selector to preserve failure behavior. Exercise preparing/no-draw/hidden publication through its actual producer or a renderer fixture.
2. **Cut grounding over and narrow the resolver.** Remove its redundant depth request and class input in the same change. Extend `entity-grounding.test.ts` for unchanged geometry; add renderer composition coverage for simple/mapped/disabled modes, indoor/outdoor/plural scopes, same-island/stacked-island receiver assignment, and class changes. Preserve complete receiver records, color ranges, mapped/analytic identities, selected roots, and pose-upload/liveness sets. A zero-cost cached depth result is not an acceptable test substitute: prove that grounding does not request it.
3. **Verify and attribute.** Compare baseline, early-class-only, and complete grounding candidates on the same fixed inputs. Repeat full-output same-frame preparations and the canonical hardware PSSM fixture. Repeat at least five alternating production pairs for simple/mapped/disabled modes; report workloads, spread, and the disabled control. The current simple workload should lose all approximately 267 grounding depth requests per frame, comprising 249 non-casters and 18 actors. Actual mapped/selection consumers must still prepare depth when required. A live indoor capture is additional evidence when a suitable scene is available; synthetic indoor correctness is required regardless. No visual acceptance is implied.
4. **Clean up.** Update focused tests and mocks, remove dead resolver fields/imports and grounding-depth vocabulary, run type/lint/dead-code/format/whitespace checks, and retain final build/probe provenance. Temporary baseline controls stay outside production. Restore saved settings and disconnect diagnostics.

The accepted concession is a cheap scalar admission calculation during an existing color-range walk. Measure shadows-disabled overhead because that walk is shared. Earlier class-only timing is a lead for simple mode, not a promise for this revised candidate. Its combined saving is unmeasured, and the current mapped outdoor view already avoids grounding depth construction.

### Fix 2 — borrow renderer inputs and copy at the retention boundary

**Goal:** stop creating owned bounds/placement snapshots for synchronous footprint, scope-routing, and caster calculations, while keeping cached static drawing inputs independent of later scene mutations.

The crucial lifetime constraint is concrete: `SceneGraph.#syncSpatialSubtree` reuses and mutates the existing `localToLandblock` matrix. Replacing the surrounding resolved-state record does not make that matrix immutable. `CompiledObjectDrawStore` retains static submissions across frames, and `#compileStaticNodeSubmissions` currently stores the resolved placement matrix in those submissions. A global change from copied to borrowed placement would violate that retention contract.

The chosen cutover is:

```text
Scene layer: readResolvedState / readResolvedBounds
  -> borrowed contribution and footprint facts, consumed synchronously
     -> footprint rejection, dynamic color/grounding, or caster ranking
     -> first static compilation only:
        copied getResolvedPlacement -> owned cached static submission
```

- **Dynamic contributions:** add the existing `readResolvedState` port to RenderWorld's scene dependency and borrow its root placement for descriptor consumption. The current renderer/caster consumers derive owned bounds, anchors, distance/ranking scalars, and identities; their returned submissions do not need to retain the borrowed root placement. Keep missing-node failures explicit.
- **Static footprints:** replace `getResolvedBounds` with a documented borrowed `readResolvedBounds` method and update the bounds-result contract. The current sole production consumer is RenderWorld's footprint construction, so a second copied-bounds API is not justified solely to preserve tests. Node creation/update continues to own its inputs defensively.
- **Static compilation:** make `resolveStaticObjectNode` obtain an owned placement with the existing copied `getResolvedPlacement`, only when its caller's static submission cache misses. Remove its footprint argument, whose only job was reusing the earlier placement snapshot. Keep the cached submission's owned matrix and existing cache identity/invalidation behavior. Generated containers and EnvCell shells retain the appropriate existing copied-placement paths.
- **Particle scope lookup:** `RenderWorld.getRenderScopeKey` returns only a scope-key value. Resolve it from `readResolvedState` without copying the whole transform. `ParticleRenderBatcher.route` resolves each source owner while routing; do not invent an owner cache or claim a fixed clone saving from the 206-owner population before counting this path.
- **Indoor cell facts:** `getIndoorGroundingEnvCellFacts` also copies a transform merely to read the shell's scope. Use `readResolvedState` internally, preserve its explicit missing-node/outdoor-residency failures, and retain the existing returned scope snapshot with a small scope copy. Its translated cell bounds remain unchanged. This removes an unnecessary matrix snapshot without changing the facts result's ownership contract.
- **Contract cutover:** rename `getRenderContributionDescriptor` to `readRenderContribution`, document its borrowed nested facts, and update the caster-world type, WebGL2 adapter, ordinary consumer, and mocks together. Static ownership begins at `resolveStaticObjectNode`, not in the footprint record. Preserve `getResolvedPlacement`, `getResolvedOrigin`, and `getNode` as owned inspection/snapshot APIs.

This keeps borrowing in the app-local scene/renderer boundary. No callback framework, reference-counted snapshot, generation cache, or global mutable scratch placement is needed. The same-frame execution rule is explicit: no borrowed contribution or bounds may cross a scene mutation, asynchronous handoff, or retained submission. If an additional retaining caller is found during implementation, copy at that named boundary or stop and revise this scope; do not weaken the rule with an implicit fallback.

Production changes are concentrated in `scene/index.ts`, `scene/scene-graph.ts`, `renderer/render-world.ts`, `renderer/webgl2-renderer.ts`, and `renderer/outdoor-pssm-casters.ts`. Expect **tens of net lines, approximately -10 to +50**, plus updated tests. Most changes replace read calls or remove the footprint argument; no new production module is expected. Remove or collapse `#requiredPlacement` if the cutover leaves it with only the static-compilation caller; do not retain obsolete dynamic/EnvCell label arms or introduce another generic forwarding helper. This is an ownership correction and copy-removal candidate, with no measured saving yet.

Acceptance and implementation sequence:

1. **Make the ownership boundaries testable.** Use a real SceneGraph and RenderWorld. Check values and identity of borrowed reads within a synchronous query; verify owned placement/origin/node snapshots remain independent after mutation. Replace copied-bounds snapshot assertions with the surviving owned-placement API, and add borrowing-contract coverage. Do not mutate a borrowed result and expect defensive-copy behavior.
2. **Cut over both readers and the cold owner.** Update the complete caller/adapter vocabulary. Use a fake copier/spy or real graph reference to prove warmed dynamic/static footprint reads and scope lookups do not call copied-placement access. Require static cache misses to copy and cache hits to reuse their owned submissions. After a scene transform mutation, newly read facts must reflect it while a previously compiled owned matrix remains unchanged, preserving the current static-publication contract.
3. **Prove output equivalence and lifetimes.** Cover node removal, parent/attachment transform changes, landblock re-anchoring, plural scopes, static publication replacement and cache flushes, generated containers, and EnvCell shells. Compare ordered color submissions, shadow inputs/receiver records, routed particle scopes, and animation-liveness identities on fixed and same-frame inputs. Borrowing must not alter first-seen transparency order or become a stale frame cache.
4. **Count before assigning a performance win.** Record descriptor/scope/compilation copy counts separately, with cold compilation separated from warmed frames. Repeat at least five production pairs and a regular build smoke, with the same no-sampling/no-readback measurement controls. The earlier 337 ordinary descriptor copies are attribution from an older workload, not a promised number of removable copies in the current scene. Preserve necessary cold static copies. Run focused scene/RenderWorld/caster/cache tests, standard static checks, and appropriate canonical GPU/portal/selection fixtures; remove temporary controls and retain evidence.

### Ordering and decision gates

Implement and review **Fix 1 first**, keeping its class-only diagnostic as an attribution control. It resolves two confirmed mismatches with a small consumer change; its largest demonstrated opportunity is simple/indoor grounding. Then implement and measure **Fix 2 independently**, because it affects the current mapped workload as well and carries the more consequential ownership risk. Do not mix their timings or advertise an aggregate FPS gain.

Neither scope includes particle GPU work or additional quality reductions. Keep the completed first optimization as the baseline, and retain its evidence unchanged. Before each follow-up is considered complete, require its own correctness proofs, production measurements with ranges, source/build provenance, cleanup, and a bounded final quality review.

## Follow-up implementation validation

Status: **Both scoped changes implemented and verified in the working tree; uncommitted.** The admission helper now returns the retained source-cohort count and exact material-free geometry flag from one complete logical-range walk. Grounding consumes it after class admission and never requests depth preparation. The geometry resolver no longer accepts or checks a class. The shared depth predicate preserves partial opaque fades while excluding cutouts. The helper returns one small typed summary per available publication and reuses the existing cohort scratch set; it adds no per-range object or persistent eligibility cache.

Scene bounds and renderer contributions now have explicit borrowed-read contracts. Scope routing reads scope values without transform snapshots. Indoor cell facts keep their owned scope copy while avoiding the unused matrix copy. Static compilation explicitly copies placement on its cache miss, so the retained matrix remains independent of subsequent scene mutations. The old contribution/bounds getter vocabulary and redundant placement helper have been removed from current production code.

The final focused run passed **164 tests in ten files**, including logical/physical range-admission comparisons and real SceneGraph/RenderWorld/CompiledObjectDrawStore ownership checks. Static cache hits reuse the owned placement; a cache flush takes a fresh copy. Type checks, TypeScript lint, dead-code lint, touched-file formatting, production build, and whitespace checks passed. Type checks reported no errors or warnings. Two initial verification failures were corrected before accepting results: a root-movement test used the child-transform API, and the adapter argument removal also removed an unrelated receiver-policy argument. Neither failed run contributes performance evidence.

The production-minified disposable comparison embeds the exact pre-follow-up collector and copied-read helpers from source snapshots. Its three modes are baseline, grounding-only with copied reads, and both fixes with borrowed reads. All **30 same-frame contribution comparisons** passed across mapped/simple/disabled shadows, together with **10 mapped-pass comparisons**. Acceptance compares complete serialized receiver records, ordered draw inputs and resource identities, selected roots, and pose matrices/colors; immutable staged geometry/resources are compared by object identity rather than duplicating their vertex/index buffers. Strings are compared directly; retained hashes are labels. Selection and pose-input state is restored before each variant.

The live count windows confirm zero grounding depth requests in both optimized modes, and zero warmed-frame matrix clones from contribution, routing-scope, and indoor-fact reads with borrowing. Necessary static compilation copies remain at their cold owner; the warmed live count windows happen to contain no static compilations. Frozen ownership tests exercise that copy boundary explicitly.

### Removed work in the newer live workload

Nine two-second count windows cover all three variants under mapped/simple/disabled shadows. Each row is divided by its own frame count, not treated as a frozen population. The dominant population remains 206 owners; visible actor counts have changed since the earlier audit.

| Work per frame | Baseline | Grounding fix | Both fixes |
| --- | ---: | ---: | ---: |
| Simple-mode grounding depth requests | 292.477 | **0** | **0** |
| Simple-mode non-caster grounding depth requests | 258.477 | **0** | **0** |
| Mapped-mode color-contribution matrix clones | 368.970 | 368.000 | **0** |
| Mapped-mode shadow-contribution matrix clones | 60.000 | 60.000 | **0** |
| Mapped-mode particle scope-lookup matrix clones | 422.376 | 421.280 | **0** |
| Mapped-mode indoor-cell-fact matrix clones | 25.000 | 25.000 | **0** |

The mapped-mode total is approximately **875 targeted matrix clones per frame**, removed by borrowing. That is a count, not time spent cloning or proof that all allocations disappear. Other renderer clones remain. The baseline simple-mode depth requests include approximately 258 non-casters and 34 actors; the older 249/18 split is a different live workload. No static compilation occurs in these warmed count windows, so they do not establish that compilation needs no copies.

The counter called `mappedDepthRequests` in the disposable raw capture counts all requests within the **PSSM feature pass**, including its analytic fallback tier. The summary names it `shadowPassDepthRequests`. It remains 32 per mapped-mode frame: eight mapped-root requests plus 24 analytic-tier geometry checks. These are preparation requests, not 32 mapped roots, unique preparations, or GPU draws. The analytic tier's depth result is also richer than its geometry/scope admission need, but it selects off-camera roots before ordinary color collection. Reusing a color-only boolean there would be wrong. That residual path remains separate; no additional eligibility query/cache was introduced in this change.

### Separate timing attribution

Forty-five windows form five matched rounds per shadow mode, with baseline/grounding/both variants in each round and reversed order on alternate rounds. Each uses 1.5 seconds of settling and four seconds of capture. Counter hooks are removed before timing; common diagnostic dispatch/read wrappers remain. No V8 sampling, image readback, builds, or heavy analysis runs during the windows. The baseline embeds the actual pre-follow-up collector and copied-read helpers; it already includes the first shadow-query optimization.

Scene-contribution CPU medians and minimum–maximum ranges, in ms:

| Mode | Baseline | Grounding only | Both fixes |
| --- | ---: | ---: | ---: |
| Simple | 3.489 [2.646–3.700] | 3.080 [2.381–3.236] | 3.115 [2.934–3.279] |
| Mapped | 2.888 [2.797–3.228] | 2.782 [2.762–2.896] | 2.675 [2.671–2.860] |
| Disabled | 2.786 [2.452–2.878] | 2.638 [2.223–3.023] | 2.711 [2.338–2.804] |

Within-round phase differences isolate the two changes more directly than subtracting unrelated sessions. Positive means less CPU work:

| Mode | Grounding saving, ms | Additional borrowing saving, ms |
| --- | ---: | ---: |
| Simple | **0.381 [0.265–0.620]**, positive in 5/5 rounds | 0.073 [-0.898–0.146], positive in 3/5 |
| Mapped | 0.121 [-0.099–0.446], positive in 4/5 | 0.108 [-0.092–0.221], positive in 4/5 |
| Disabled | 0.149 [-0.168–0.267], positive in 3/5 | -0.115 [-0.166–0.313], positive in 2/5 |

The simple-mode grounding result is the clearest timing evidence. Borrowing's additional saving is small relative to the spread, and the disabled control exposes substantial variation even where grounding does no work. Visible dynamic populations range from 323 to 330 across the run. Mapped-mode frame-work medians are 14.253 / 13.909 / 13.788 ms; baseline-minus-both within-round frame-work saving is 0.450 [-0.072–0.771] ms. Simple-mode combined frame-work differences include a large reversed round. The unchanged GPU workload also varies. **Do not turn these into an aggregate FPS guarantee or add the earlier 0.54 ms result from another session.** Full renderer/frame/GPU/throughput ranges are retained in the summary.

### Frozen, GPU, production, and quality verification

The new frozen fixture passes **300 compositions**, adding unavailable publication to the earlier compiler/range/class/scope/geometry cases. The carried source-range boolean exactly matches full depth presence before class policy is applied. Two hundred cases reach indoor membership and 18 produce nonempty indoor output. The focused tests additionally cover alpha-test-only roots, partial fades, shared source-cohort identities, and validation of a missing later part after an earlier eligible range. No live indoor actor or user visual acceptance is claimed.

Canonical hardware-GPU **outdoor PSSM and entity-selection fixtures pass**, including posed depth, target lifecycle, selection opacity policy, and scoped selection-mask pixels. Their Chrome backend uses ANGLE Vulkan; the live comparison and normal production smoke use native Electron ANGLE GLES.

The canonical **portal-scope-atlas fixture fails** `particleMatchesEquivalentTransparency`. It fails both a repeated current run and a run serving the preserved pre-follow-up renderer, RenderWorld, scene, depth, and grounding sources. All three complete executor-evidence objects have the identical SHA-256 `25cd8cb0593db8611ec071b85bb0020296b143a3b7f5a46091c5e1e563b45d60`; each has 432 differing color bytes between particle and equivalent-transparency outputs, maximum byte difference 172. Other executor oracle booleans in that object are true. This establishes that the failure predates these two changes; it does not diagnose its cause or establish a passing portal fixture. The numeric failure and source-override recipe are retained as a separate GPU issue. No assertion or shader was relaxed to make it pass.

A normal production build then passed five native-GPU smoke windows with all diagnostic class globals absent and mapped shadows enabled. Its frame work is 14.472 [14.213–15.061] ms, scene contribution CPU 2.949 [2.881–3.061] ms, and particle GPU time 5.275 [5.109–5.327] ms, with 323–325 visible dynamics. It is a separate session, not another causal pair. The disposable build was rebuilt after formatting and ownership comments; all minified JS asset hashes are identical to the measured build. Successful live clients disconnected, the original graphics settings were persisted and verified, and the baseline Vite server was stopped.

The final quality review traced the source-to-physical range mapping, fade/cutout policy, class-to-geometry cutover, all contribution/bounds callers, scope routing, in-place matrix updates, inspection snapshots, and retained static compilation/cache flushes. The two follow-ups add **43 net production lines** relative to the first fix, across the existing modules; all three CPU changes together add 53 net production lines across eight existing files. One small per-publication admission summary is the accepted allocation trade-off. There is no new persistent cache, shared-crate API, renderer setting, diagnostic switch, or production file. No blocking issue was found in the changed ownership and admission contracts. The reproduced portal oracle failure and off-camera analytic-tier preparation remain explicitly open.

Evidence: [follow-up results and complete ranges](evidence/world-particle-performance-2026-10-16/followup-summary.json), [accumulated production/test patch](evidence/world-particle-performance-2026-10-16/followup-change.patch), and the trial, frozen-fixture, GPU-fixture, production-smoke, and source archive entries in the [manifest](evidence/world-particle-performance-2026-10-16/manifest.json).

## Two-program spatial partition follow-up

Status: **Investigated, not implemented. Production and checked-in harness source remain unchanged in this follow-up.** Temporary controls, live/frozen measurements and numeric fixtures are retained. The earlier CPU changes remain the baseline.

### The portal fixture failure is a setup defect

The canonical portal fixture's [`createParticleFixtureProgram`](../../apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-scope-atlas-executor-fixture.ts) links `createParticleFragmentShader(true)` and initializes its material/alpha-test uniforms, but never initializes **`uOpacityScale`**. The production fragment shader multiplies alpha by that uniform. The fixture therefore leaves its particle draws fully transparent, while the equivalent-transparency reference uses alpha 0.5. Production [`WebGL2ParticlePass`](../../apps/holtburger-3d/src/lib/game/renderer/webgl2-particle-pass.ts) explicitly uploads its context opacity and does not have this omission.

A disposable Vite source transform adds **only** `gl.uniform1f(requireWebGL2Uniform(gl, program, "uOpacityScale"), 1)` after the fixture's alpha-test setup. The canonical `portal-scope-atlas --gpu --full-report` run then exits zero; `particleMatchesEquivalentTransparency` is true, the fixture is ready, and its reported error is null. It runs on ANGLE Vulkan / RADV Radeon 780M. This verifies the cause of the retained failure rather than weakening its oracle. No checked-in fixture assertion or shader was changed. The small harness initialization correction remains to be implemented. This failure does not establish a production visibility defect and does not explain the measured GPU cost. Historical failed evidence remains unchanged.

### Keep exact depth, reduce five regions to two

The earlier spatial prototype used the full shader inside one conservative rectangle and four no-portal scissor strips outside it, multiplying the dominant draws fivefold. The new diagnostic instead uses:

1. The **unchanged production portal shader**, scissored to the checked rectangle.
2. A separate material shader that rejects pixels inside that rectangle using **screen XY only**, and has no portal metadata block, envelope sampler or builtin fragment-Z input.

The rectangles are complementary half-open pixel regions. No pixel receives both physical submissions, so each pixel retains its original blend order. The live prototype partitions each logical draw immediately, preserving interleaving with other particles. The frozen prototype executes each region's complete ordered sequence separately; this reordering is valid because the regions are disjoint. Both retain materials, geometry, record/clock inputs, depth testing, opacity, and the 206-effect population. Dominant submissions rise from **206 to 412**, rather than 1,030. No lower-resolution target, quality cutoff, depth reconstruction or epsilon-adjusted visibility comparison is used.

The diagnostic uses the same root-sourced crossing-stream projection as the earlier spatial work: enclosing rectangle, three-pixel guard, full-view fallback at nonpositive/near-zero clip W. A GPU envelope read verifies skipped pixels after measurement; it never chooses visibility policy. The three-pixel guard remains an empirical diagnostic margin, not a proved cross-device bound.

### Frozen GPU result in the current view

A new native GLES capture retains one frame's resources in their original context, then pauses live rendering. The viewport is **1531 × 916**; the root plan has **six crossings / 16 triangles**, and the checked rectangle is `[65,565,732,622)`. Its root envelope is entirely unrestricted in this capture. The dominant output changes 48,374 pixels relative to its opaque background, substantially less coverage than the older approximately 147,000-pixel capture. The user subsequently confirmed moving the character, explaining the changed view between captures. Exact before/after character and camera poses were not retained for this comparison. These numbers describe the new location and must not be substituted into the earlier approximately 5 ms result.

All three variants match the frozen original RGBA8 output byte-for-byte. Verification reads disposable color copies, preserving the earlier driver/readback lesson. Five alternating rounds per variant measure 40 GPU elapsed samples after eight warmups. Setup, reset blits, copies and reads are outside the query; both candidate submissions are inside it.

| Frozen dominant draws | GPU ms, median [minimum, maximum] | Physical draws |
| --- | ---: | ---: |
| Original | 1.868 [1.864, 1.890] | 206 |
| Two regions | **1.022 [1.018, 1.025]** | 412 |
| No portal, diagnostic control | 0.984 [0.974, 0.987] | 206 |

The repeated original validation has zero differing pixels, zero external live draws, and no GL error. The envelope check finds zero unsafe bypassed pixels. This demonstrates a cheaper execution path for the captured inputs; an unrestricted live envelope alone cannot validate finite boundaries.

### Boundary and blend-order verification

A standalone synthetic native GLES fixture imports current production visibility GLSL and compares complete RGBA8 outputs of the original and two-region paths. Nine geometry/depth shapes cover constant mid/far, sloping/perspective, large W range, near/far clipping, eye-plane crossing and narrow triangles. Three translations, finite/window/unrestricted/uncovered envelopes, eleven near-boundary offsets, and scene-depth testing enabled/disabled are exercised. Each case also runs a three-layer alpha-blend schedule to verify ordering across the partition seam.

**2,592 comparisons per process pass with zero differing bytes**, repeated in two fresh processes with identical per-case records. An intentionally empty checked rectangle produces **184,890 differing bytes** in the finite-window negative controls. The fixture therefore exercises cases where skipping finite-depth rejection is wrong. Unlike the rejected depth-varying candidate, the checked program retains builtin fragment depth exactly.

This validates the partition and its ordering under the supplied bounds. It does **not** prove a general CPU-to-GPU projection bound or full traversal behavior. The synthetic envelope is unrestricted outside finite geometry; its opaque depth attachment is clear to one, so the enabled/disabled runs verify depth-state routing rather than a realistic occluder distribution. No timing or visual acceptance is taken from these synthetic runs.

### Live GPU saving, measurable CPU trade-off

Five matched native GLES pairs reverse order on alternate rounds, with 1.5 seconds settling and four seconds measurement. The viewport is **1532 × 917**, checked rectangle `[65,565,732,623)`, with all **206 dominant logical draws per sampled frame** in both modes. The original uses 206 physical draws; the candidate uses 412. Visible dynamic counts range from 258 to 263 across the run. All ten post-window envelope checks find no unsafe skipped pixels; these envelopes are also entirely unrestricted.

| Live metric | Original median [range] | Two regions median [range] |
| --- | ---: | ---: |
| Particle GPU ms | 2.342 [2.227, 2.826] | **1.503 [1.410, 1.585]** |
| Total measured GPU ms | 8.363 [8.082, 8.955] | 7.727 [7.398, 7.764] |
| Particle submission CPU ms | 1.110 [1.047, 1.169] | **1.555 [1.490, 1.773]** |
| Renderer CPU ms | 5.784 [5.336, 6.238] | 6.035 [5.759, 6.376] |
| Synchronous frame work ms | 9.196 [8.499, 9.893] | 9.237 [8.751, 9.705] |
| Observed FPS | 59.601 [57.491, 59.880] | 59.965 [58.398, 60.010] |

The median **within-round original-minus-candidate** particle GPU saving is **0.817 [0.642, 1.323] ms**, positive in all five rounds. Total measured GPU saving is 0.684 [0.548, 1.228] ms, also positive in all five. Particle submission CPU instead **increases by 0.468 [0.321, 0.636] ms**, in all five rounds. Synchronous frame-work saving is **-0.042 [-0.370, 0.384] ms**, positive in only two rounds. GPU and CPU overlap and these values must not be added. The small FPS change near the refresh cap does not establish a broad improvement.

The timing paths share GL prototype uniform tracking, buffer mirrors and frame-plan projection. The candidate additionally forwards changed uniforms and switches programs/scissors per logical draw. That extra submission cost is a real prototype cost; it does not predict an implementation that owns its state directly. No V8 sampling, readback, build or heavy analysis overlaps timing windows. Proof reads use separate targets. The hook restores original GL prototype descriptors and disables profiling before disconnecting; no quality setting was changed.

### Narrow next design scope

The result supports a correct-depth alternative to the rejected varying substitution, but **does not justify shipping this per-draw wrapper**. The next app-local renderer experiment should address both ownership and submission:

- Derive conservative root departure coverage at the existing **portal window/crossing-plan producer**. The [window arena](../../apps/holtburger-3d/src/lib/game/renderer/portal-window-arena.ts), [scope culler](../../apps/holtburger-3d/src/lib/game/renderer/portal-scope-window-culler.ts) and [crossing stream](../../apps/holtburger-3d/src/lib/game/renderer/portal-crossing-triangle-stream.ts) already own projection and selected-domain facts. Carry one frame-valid region into deferred submission; do not reconstruct it independently in the particle consumer or use GPU reads as policy. Near-eye/clipping/root changes and raster bounds require proof or a conservative full-path fallback.
- Let **`WebGL2ParticlePass` own the shader programs and physical submission**, reusing its material shader generation, record upload and device-state applicator. The present `routeDeferredSubmission` port supplies a domain uniform after program selection; a region must be available before selecting programs. Avoid installing prototype mirrors or per-draw shader clones in production.
- Investigate **two ordered traversals within one eligible scope**, switching programs once per region, instead of twice per batch. Every batch in that scope must participate in the same disjoint partition. Preserve the existing order between scopes and other draw kinds; globally grouping outside draws across different domains is not justified by this proof. Doubled vertex/draw work remains even after program switches are reduced.
- Require paired end-to-end evidence before adopting it. Revisit the heavier original coverage, finite portal views, camera movement, root changes and streaming. Retain exact-boundary comparisons and lifecycle/state checks. Distance/footprint admission remains a separate option.

No shared Rust/world semantics, new render target, stencil resource or shared-depth representation is required by this experiment. Exact hardware scheduling/stall attribution of the expensive builtin-Z path remains open.

Evidence: [two-program results and complete ranges](evidence/world-particle-performance-2026-10-16/two-way-summary.json), compressed frozen/live/boundary/control captures and disposable probe sources in the [manifest](evidence/world-particle-performance-2026-10-16/manifest.json). Earlier failed portal captures and the rejected varying candidate remain retained as historical evidence.

## Current spot after user repositioning

The user moved the character and requested a check of the new spot. Five four-second ordinary-production windows on native Radeon 780M GLES, after ten seconds settling, measure **3.788 [3.738, 3.880] ms particle GPU** and **8.688 [8.576, 8.936] ms total measured GPU**. This is a useful heavier particle baseline than the preceding location, while remaining a different workload from the original approximately 5 ms view. No experimental shader, draw hook, V8 sampling or pixel readback is installed for this check.

The viewport is **1535 × 919**, render scale one, with mapped shadows. The host camera-path endpoint remains identical in all five windows: landblock/cell `0x482d0011`, local coordinates approximately `(54.665, 12.000, 8.242)`. This records a return-location reference, not the full rendered camera matrices or a guarantee that the probe matches the user's exact framing. No movement input is sent; profiling is disabled before disconnecting. Particle-owner census and numeric image footprint were not measured in this production-only check.

All five windows report **one selected scope and zero selected portal crossings**. This view therefore supplies a simpler next diagnostic. Source tracing confirms that [`executePortalScopeAtlasWebGLCalls`](../../apps/holtburger-3d/src/lib/game/renderer/portal-scope-atlas-command-model.ts) clears the envelope to `PORTAL_SCOPE_ENVELOPE_UNBOUNDED_DEPTH` when traversal depth is zero and skips all propagation/reduction iterations. Its validator requires an empty crossing stream and exactly one render domain for that case. The root tile covers the viewport, and the shared deferred predicate accepts envelope depth one without a fragment-depth restriction. This establishes the existing renderer's root-only portal-admission invariant; ordinary opaque depth testing remains separate. Selecting the existing plain particle program for that proved case could avoid the portal shader without any draw expansion. This admission control has **not** been implemented or measured here; implementation-level exact-output validation must precede adoption. It would complement the two-region investigation, whose benefit is relevant when the plan does retain exits. This spot cannot replace finite doorway/boundary validation.

Evidence: [current spot summary and complete ranges](evidence/world-particle-performance-2026-10-16/current-spot-summary.json), retained windows and source tools in the [manifest](evidence/world-particle-performance-2026-10-16/manifest.json). Restore `current-spot-probes.tar.gz` with the existing basename-only procedure, use the earlier production launcher/credential runner, then run `H3D_PROBE_SCRIPT=/tmp/h3d-current-spot-probe.mjs node /tmp/h3d-run-native.mjs current-spot 1`. The probe does not move the character. `python3 /tmp/h3d-validate-current-spot.py` validates recorded hashes, five windows, stable path position and the zero-crossing observation.

## Door-facing orientation check

The user then turned the character toward a door. The probe initializes its yaw from authoritative player facing in [`ClientPresentationSession.#ensureCamera`](../../apps/holtburger-3d/src/client/client-presentation-session.ts), using its configured default pitch/distance. Startup-only observers retain the scoped particle program's complete view/projection matrices; both GL methods are restored before timing, and the temporary global is removed. No exact match to the user's manually orbited framing or visual acceptance is asserted.

Five four-second production windows now consistently select **23 crossings and 26 scopes**, versus zero crossings and one scope in the preceding facing. Particle GPU time is **4.071 [4.014, 4.139] ms**; total measured GPU is **10.759 [10.671, 10.978] ms**. Synchronous frame work is **12.158 [11.167, 12.462] ms**. The new view also retains 317 visible dynamic entities and 391 particle batches, with 2,077–2,119 submitted particle instances. These differ from the preceding 294 dynamics / 312 batches, so the timing difference is not an isolated measurement of added portal work.

The viewport is **1539 × 924**. The recorded host camera-path endpoint remains stable across all five windows at `0x482d0011`, approximately `(51.012, 5.673, 8.242)`; its change from the prior endpoint can include camera placement around the turned character and is not a measurement of character translation. Render scale remains one with mapped shadows, original particle shaders, no diagnostic class globals, and no sampling/readback/build work during timing. Profiling is disabled and the client disconnected after capture.

This activates the CPU portal workload needed alongside the zero-crossing baseline. The no-selected-exit admission condition no longer holds; a cheaper program here needs a proved unrestricted screen region or must retain the existing predicate. Selected crossings alone do not prove a particular finite-envelope pixel or validate candidate fragment decisions. No shader optimization, envelope census or boundary acceptance is performed by this check.

Evidence: [door-facing summary, matrices and complete ranges](evidence/world-particle-performance-2026-10-16/door-spot-summary.json), retained windows and disposable probe/evidence tools in the [manifest](evidence/world-particle-performance-2026-10-16/manifest.json). Restore `door-spot-probes.tar.gz`, use the existing production launcher/credential runner, and run `H3D_PROBE_SCRIPT=/tmp/h3d-door-spot-probe.mjs node /tmp/h3d-run-native.mjs door-spot 1`. `python3 /tmp/h3d-validate-door-spot.py` checks recorded hashes, five windows, captured matrices, hook restoration, stable path position and nonzero selected crossings. It does not move or rotate the character.

## Historical temporary particle bypass for manual observation

The user explicitly requested treating particle instances as unrestricted temporarily for their own visual evaluation. **At this stage, `BYPASS_PARTICLE_PORTAL_VISIBILITY_FOR_MANUAL_REVIEW = true` was active** in [`webgl2-renderer.ts`](../../apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts). The renderer passes null routing to `WebGL2ParticlePass.drawScoped`; that method accepts null and submits the already admitted, ordered world batches through its existing ordinary particle program. This skips the portal-envelope shader rather than merely branching around its depth input. Sky separation, CPU scope admission, particle population/simulation/materials/opacity/blending, record uploads and ordinary opaque depth testing remain. Other object/portal passes are unchanged.

Four focused particle/routing/store test files pass **27 tests**. Type checks, TypeScript/dead-code lint, focused formatting, the production build and diff whitespace checks pass. A production client is opened at the current door-facing character orientation and **left running for the user**. Temporary numeric observers record 44,424 ordinary particle draws, zero portal-aware particle draws, zero fragment-Z particle draws, zero depth-disabled particle draws and zero depth-writing particle draws. At handoff the scene still selects **23 crossings / 26 scopes**. All observer hooks are restored, renderer profiling is disabled, and CDP is detached. These counts verify the intended path; they are not a GPU benchmark or visual acceptance.

**User observation:** the user reports that the temporary bypass “looks fine” in the current manual session. This is a positive manual result for the inspected view; specific additional interiors, camera paths and effects were not enumerated. No agent visual check was performed. At that stage the bypass remained enabled for continued observation. That report alone did not authorize permanent adoption, and no broader visual-equivalence or end-to-end performance claim is established. At that point a controlled timing comparison remained outstanding and the user’s session was left undisturbed. The user subsequently chose another position; the paired comparison below records its result.

**Historical restore instructions, superseded by the permanent cutover below:** the temporary implementation could restore portal clipping by setting the named constant to **false** and reloading a development build or rebuilding/relaunching production. To fully remove the temporary experiment, review and reverse only [manual-particle-change.patch](evidence/world-particle-performance-2026-10-16/manual-particle-change.patch); it excludes the earlier CPU fixes. The source archive retains exact pre-experiment copies of both changed files. Do not use a broad `git restore` that discards the prior work or overwrites later user edits. Older source-sensitive evidence validators intentionally expect their captured pre-experiment source/build hashes; this temporary source change does not justify rewriting those captures.

Evidence: [temporary bypass state, validation and restore instructions](evidence/world-particle-performance-2026-10-16/manual-particle-summary.json), numeric handoff verification and source archive in the [manifest](evidence/world-particle-performance-2026-10-16/manifest.json). Restore `manual-particle-probes.tar.gz` with its safe `original/` subdirectory handling. `python3 /tmp/h3d-validate-manual-particle.py` validates that historical experiment against its matching source state and all artifact hashes. The manual launcher uses the earlier production launcher and credential runner: `H3D_PROBE_SCRIPT=/tmp/h3d-manual-particle-probe.mjs node /tmp/h3d-run-native.mjs manual-particle 0`. It leaves the client open after numeric verification and waits for the user to close it; do not launch a second client while this session is active.

## Paired shader comparison at the user's next position

The user requested measurement at another position after the manual observation. The prior manual probe client was no longer running, so a fresh diagnostic client uses the saved character position and initial body-facing camera. The viewport is **1550 × 935**, native Radeon 780M GLES, render scale one and mapped shadows. Its host camera-path endpoint is `0x482e001c`, approximately `(87.613, 85.292, 9.425)`. All ten windows select **four portal crossings / seven scopes**. This is a different view and workload from both earlier positions.

A disposable Vite pre-transform replaces only the temporary bypass switch's use with a frame-read diagnostic global, building and serving from `/tmp/h3d-position-ab-dist`. The ordinary repository build remains the user's enabled-bypass build. Both modes retain the earlier CPU fixes; portal mode supplies normal routing to the particle pass, and bypass mode supplies null to select its existing ordinary program. No per-draw shader forwarding, extra physical draws, quality change or new visibility policy is added.

Both programs are warmed before timing. Their view/projection matrices compare exactly equal. A startup-only uniform-location observer is then restored; each measured mode's actual matrices are queried **after** its window and must equal the warmup reference. All ten windows pass this exact camera-matrix check and retain the same host path position. Five matched rounds reverse mode order on alternate rounds; each variant has 1.5 seconds settling and four seconds measurement. No V8 sampling, pixel readback, build or heavy analysis overlaps timing. Renderer CPU/GPU phase profiling is common to both modes; GPU figures retain the rolling-snapshot limitation described above.

| Metric | Portal checks median [range] | Bypass median [range] |
| --- | ---: | ---: |
| Particle GPU ms | 1.778 [1.657, 2.043] | **1.034 [1.003, 1.300]** |
| Total measured GPU ms | 7.708 [7.076, 7.949] | **7.026 [6.589, 7.095]** |
| Particle submission CPU ms | 0.345 [0.308, 0.354] | 0.334 [0.296, 0.356] |
| Renderer CPU ms | 3.933 [3.713, 4.241] | 4.029 [3.672, 4.411] |
| Synchronous frame work ms | 6.298 [6.068, 6.656] | 6.388 [5.903, 7.009] |
| Observed FPS | 59.895 [58.824, 60.055] | 59.880 [58.560, 60.040] |

The median **within-round portal-minus-bypass** particle GPU saving is **0.744 [0.399, 0.959] ms**, positive in all five rounds. Total measured GPU saving is **0.743 [0.487, 0.854] ms**, also positive in all five. Particle submission CPU saving is 0.020 [-0.047, 0.049] ms, positive in three rounds. Frame-work saving is **-0.009 [-0.941, 0.395] ms**, positive in only two rounds. This is GPU headroom with no demonstrated synchronous frame-work/FPS improvement in a view already near the refresh cap. It does not promise the same saving in the original heavier scene.

This remains a live-server comparison despite exact camera matrices. Visible dynamics range from 214 to 220; particle batches span 227–252 in portal mode versus 227–229 with bypass, and submitted instances span 639–946 versus 639–667. Within-pair portal-minus-bypass instance difference is 20 median, range 0–279; the current shader choice does not itself change the CPU batch-admission policy, but live emission and actor population do change between windows. Retain that workload imbalance when interpreting the timing rather than calling the scene frozen. No output equality or new manual visual acceptance is asserted by these trials.

After measurement, the diagnostic global is restored to bypass, the observer restored, profiling disabled, and the client disconnected. **At the time of this paired capture, the working-tree temporary bypass remained enabled** for manual evaluation. This paired investigation made no further production source edit. The user subsequently authorized permanent adoption; the cutover below supersedes this temporary state.

Evidence: [paired results, exact camera matrices and complete population ranges](evidence/world-particle-performance-2026-10-16/position-ab-summary.json), compressed trials and disposable build/probe sources in the [manifest](evidence/world-particle-performance-2026-10-16/manifest.json). Restore `position-ab-probes.tar.gz` with the basename-only procedure and the existing credential runner, then run:

```sh
npm --prefix apps/holtburger-3d run build -- --config /tmp/h3d-position-ab-vite.config.mjs
H3D_PROBE_SCRIPT=/tmp/h3d-position-ab-probe.mjs node /tmp/h3d-run-native.mjs position-ab 1
python3 /tmp/h3d-validate-position-ab.py
```

The probe rejects a changed camera and never sends movement input. It requires the temporary nullable-routing implementation; historical scripts still target their own earlier source/build assumptions. The retained validator checks all artifact hashes, current production source hashes, five complete pairs, exact matrices, host path position, sanitation and restored bypass state. It validates the recorded evidence, not a portable promise of these timings at another position.

## Permanent ordinary-particle cutover

The user explicitly chose the cheaper path after manual observation. World particles now permanently use the ordinary shader; there is no bypass switch, alternate portal-particle program, or per-draw scope-uniform routing to maintain. CPU owner/scope admission, scope-group draw order, sky scheduling, record uploads, material/alpha/blend rules, motion, and ordinary opaque depth testing remain intact. Other geometry retains portal-envelope clipping.

This is an accepted renderer policy: admitted large effects can extend across scope boundaries when resolved opaque depth does not hide them. It is not a claim that every portal envelope is unrestricted, that visibility output is universally identical, or that retail has a proven bug. The earlier user report supplies manual observation; these automated checks make no visual acceptance claim.

The incremental runtime cleanup removes **104 net lines** across the particle pass, program and renderer. A constant fragment shader replaces the boolean factory. World submission retains the existing grouped map and its order because collapsing to source order could reorder alpha layers. Sky and world share one program and one record synchronization per frame. The finite-screen CPU portal models retain their stricter, fully clipped particle reference semantics for oracle/cost comparisons; their role is now explicit in code and durable documentation.

The GPU executor fixture no longer equates particles with portal-clipped transparent objects. Its independent particle oracle composites four ordered alpha layers over root/child opaque depths. A farther green layer must pass over root depth and fail behind the nearer child, while three near layers compose across both. Transparent objects still pass their separate portal oracle. This checks the adopted particle behavior without preserving the deleted architecture in tests.

Validation completed:

- **92 focused tests across ten files**, app type checks, TypeScript lint, dead-code lint, touched-file formatting, production build, and whitespace checks passed. The build retains its existing chunk-size advisory.
- Canonical hardware GPU **portal-scope-atlas** and **entity-selection** fixtures both passed on ANGLE/Vulkan/RADV. The particle depth/blend oracle and existing transparent-object/opaque/near-plane/weather oracles all passed.
- A normal production frontend/release-host smoke passed on the original **ANGLE/GLES/radeonsi** backend. Startup observation counted **72,543** ordinary particle draws, **zero** portal-aware or builtin-fragment-depth particle draws, and **zero** draws with disabled depth testing or enabled depth writes. All GL observation hooks were restored before timing. Five four-second profiling windows completed without browser errors; profiling was disabled and the client disconnected. Saved graphics preferences were not changed.
- The current fragment template is exactly equal to the pre-cutover ordinary variant after removing whitespace. This preserves the shader measured by the earlier matched A/B: **0.744 ms median paired particle GPU saving**, with live population drift and refresh-cap limitations retained. The new smoke is a separate session: particle GPU median **1.328 ms [1.305–1.330]**, total GPU **6.862 ms [6.680–6.948]**, and synchronous frame work **7.519 ms [6.782–8.041]**. These smoke timings are context, not another causal before/after result or a guaranteed FPS improvement.

The final code-quality review traced CPU routing into world/sky submission, flattening order, shared record-store lifetime, material/uniform/state handoff, destroy/recreate behavior, the production shader's fixture consumer, and documentation/reference-model boundaries. It found no blocking issue within this cutover. Retaining grouped order and keeping the mathematical reference models separate are intentional; neither requires a replacement abstraction.

The requested pre-commit code-quality review on **2026-10-17** covered the complete accumulated diff against `86847980e`, including the three CPU improvements, tests, durable documentation and retained evidence. Verdict: **ready within the reviewed scope**, with no blocking finding or additional production change. Seam coverage included current-class publication through early scene admission and cascade selection; logical range admission through material-free depth and grounding; synchronous scene borrowing through footprint/shadow consumers and owned static-cache compilation; and particle owner admission through submission, program/resource teardown and GPU fixture assertions. Source-class replacement, hidden/empty ranges, partial fades, scene mutation and cache reuse were considered explicitly. Existing scope grouping preserves alpha order, while strict CPU portal models remain independent reference models. No new abstraction or diagnostic production path is warranted. A fresh run passed **149 tests across 12 files**; all **153** retained artifact hashes and current source hashes validated. The previously passing static/build/native/GPU evidence remains applicable because production source is unchanged. Shared Rust, transport and unrelated rendering features were outside this review; no new visual acceptance was performed. Source/documentation whitespace checks pass. Git also interprets leading context markers inside the four verbatim evidence patches as whitespace errors; these patch-format bytes are intentional and remain unchanged so the patches apply and their captured hashes stay valid.

The baseline is user HEAD `86847980e57b7dcdc2ba54cd7f351ddf073a701e` plus the earlier working-tree CPU improvements and temporary bypass. Exact pre-cutover snapshots preserve intervening user changes, including the already-committed fixture opacity initialization. The incremental patch excludes those earlier changes. Implementation captures precede the final commit, and `ACE/` remains untouched.

Evidence: [cutover summary and source hashes](evidence/world-particle-performance-2026-10-16/particle-cutover-summary.json), [incremental patch](evidence/world-particle-performance-2026-10-16/particle-cutover-change.patch), sanitized native/GPU results and the probe/snapshot archive in the [manifest](evidence/world-particle-performance-2026-10-16/manifest.json). Historical captures and hashes remain unchanged; their validators require their captured source/build state. The current validator checks all **153** artifact hashes, current source hashes, the shader-template proof, both GPU reports, five native windows, sanitation, and safe archive paths.

To restore the new diagnostics, unpack only regular files with relative paths and no `..` components from `particle-cutover-probes.tar.gz` into `/tmp`. Preserve its nested `original/` snapshots separately; they are evidence, not a bulk workspace restore. The native probe imports existing repository helpers and uses the production launcher/credential runner retained in earlier archives. Replace the old absolute workspace prefix in diagnostic scripts if restoring elsewhere. From the repository root:

```sh
python3 /tmp/h3d-validate-particle-cutover.py
H3D_PROBE_SCRIPT=/tmp/h3d-particle-cutover-native-probe.mjs node /tmp/h3d-run-native.mjs particle-cutover-native 1
npm --prefix apps/holtburger-3d run harness:browser -- --fixture portal-scope-atlas --gpu --full-report
npm --prefix apps/holtburger-3d run harness:browser -- --fixture entity-selection --gpu --full-report
```

Run GPU fixtures and native timing separately. The validator is read-only and needs no server or credentials; the native probe uses the existing local credentials and disconnects automatically. The archived preserver expects complete capture-specific `/tmp` outputs; it is not required to validate retained evidence.

## Current assessment and remaining work

The evidence supports extreme overlap amplifying a costly builtin fragment-depth input path on this GLES backend. Corrected ablations show that the envelope fetch alone is relatively cheap, while depth varyings evaluate the predicate more cheaply and match the captured live scene. The subsequent boundary fixture proves that their rounding behavior does not preserve the existing visibility decisions generally. It does not support blaming the dedicated sky path, palette filtering, duplicate emitter accumulation in this trace, the gutter loop, blending alone, root metadata arithmetic alone, or `discard` alone. Vertex/submission work remains, but the zero-area and scissor experiments show that it cannot account for most of the dominant population's normal GPU cost.

A modern integrated GPU can still pay materially for tens of millions of overlapping layers. That explains the workload; the depth-varying candidate demonstrates that a substantial part of the current GPU cost is avoidable in the captured view without reducing the population or resolution. Exact GPU instruction scheduling, cache behavior, bandwidth, and occupancy remain unmeasured.

The remaining work is:

1. **Profile residual CPU work after the implemented fixes.** Early shadow-query admission, range-derived grounding eligibility, and borrowed renderer reads are complete. The PSSM analytic tier still builds depth data to establish geometry/outdoor-scope eligibility for off-camera actors; investigate that producer boundary separately rather than reusing color-only admission. Group aggregate bounds, current-class lookups, remaining copies, and ordinary color work remain. Continue to account for live-server drift, profiling/diagnostic overhead, and unchanged GPU variation rather than treating shadows-off cost as an optimization budget.
2. **Census and design distance/footprint admission independently.** Recover authored maximum distances and fallback semantics across particle meshes. Compute the derived policy once at its owning content/renderer boundary, then carry it through a typed contract. Integrate existing hidden-emitter lifecycle handling and preserve conservative geometric bounds. The 100-unit dominant-mesh experiment is evidence, not a generic implementation.
3. **Profile remaining GPU costs under the adopted particle policy.** The permanent ordinary shader removes the measured portal-depth dependency from all admitted particles. Reconstructed depth and per-draw spatial partitioning remain rejected or diagnostic alternatives, not pending implementation. Other geometry still owns its portal envelope; do not generalize the particle concession to it. Portal composition and terrain retain separate leads. Hardware stall/occupancy/invocation attribution remains open; the timing result does not prove lost early Z.
4. **Broaden observation of the adopted policy.** The user accepted the visibility concession after manual observation. Other outdoor effects, indoor/portal views, camera movement, and streaming remain useful coverage for later user testing. Particle improvements alone do not prove a complete 60 Hz budget across scenes; retain the workload and refresh-cap limitations when making performance claims.

Batching could reduce CPU submission and draw overhead, but it does not by itself remove overlapping fragment work. The initial draw-count hypothesis was therefore incomplete. A separate lower-resolution effect target would reduce pixel workload—half width and half height means one quarter as many target pixels—but introduces composition/depth/portal handling and potential edge/detail artifacts. It was discussed as a possible long-term soft-effect technique, has not been implemented or benchmarked, and is deferred while narrower renderer inefficiencies are investigated.

Production changes suggested by this work belong in the app-local browser renderer and its typed content adapter. They should not move portal composition or quality policy into shared authoritative world-state crates.

## Evidence retention and reproduction

The [evidence directory](evidence/world-particle-performance-2026-10-16/) contains nineteen readable summaries, sanitized per-trial captures, decoded mesh metadata, numeric coverage/envelope captures, sixteen compressed V8 profiles, native shader/assembly evidence, the spatial, native, frozen GLES, readback/depth follow-up archives, controlled boundary fixtures, CPU work audits, the early-filter implementation/proof/control/smoke evidence, the broader late-admission audit, both implemented follow-ups, the two-program spatial investigation with portal-fixture diagnosis, the temporary bypass and matched position comparison, and the permanent cutover with native/GPU validation. Disposable probe sources are archived, beginning with the [original archive](evidence/world-particle-performance-2026-10-16/diagnostic-probes.tar.gz). The manifest records SHA-256 hashes for **153 artifacts**, approximately **5.3 MB** in total.

Sanitization removes credentials/launch command lines, selected character names, player GUID fields, raw host output, page/UI snapshots, and unrelated entity/inventory dumps. Console message level/count is retained without message text. Emitter owners, world origins, camera placement used by the distance test, and numeric renderer metrics remain because they are evidence. V8 profiles are standard sampling profiles, not heap dumps; production minified symbols may require the original matching build/source maps to resolve further. Build outputs and source maps are not archived.

The probe archive preserves disposable diagnostics rather than installing them as a supported app API. Scripts were derived from the existing UI probe and include unused branches for other modes. Use **profile mode only** for this investigation. Production probes intercept shader source/draw calls before world entry; development probes intercept classes through Vite imports. The archive's original pilot source caveat is recorded above and in the manifest.

To restore the probes on the same Linux workflow, run this from the repository root. It expands only the archived diagnostic files into `/tmp` and replaces the original absolute workspace prefix with the current checkout path:

```sh
python3 - <<'PY'
from pathlib import Path
import tarfile

bundle = Path('docs/plans/evidence/world-particle-performance-2026-10-16/diagnostic-probes.tar.gz')
bundles = [bundle, bundle.with_name('spatial-diagnostic-probes.tar.gz'),
           bundle.with_name('native-diagnostic-probes.tar.gz'),
           bundle.with_name('isolated-diagnostic-probes.tar.gz'),
           bundle.with_name('depth-diagnostic-probes.tar.gz')]
for bundle in bundles:
    with tarfile.open(bundle, 'r:gz') as archive:
        for member in archive.getmembers():
            source = archive.extractfile(member).read().decode()
            source = source.replace('/home/me/code/holtburger', str(Path.cwd()))
            (Path('/tmp') / member.name).write_text(source)
PY
npm --prefix apps/holtburger-3d run build
npm --prefix apps/holtburger-3d run build:electron:main
```

The helper `/tmp/h3d-run-profile.mjs` reads `ACCOUNT` and `PASSWORD` with Node's dotenv parser from the app's `.dev.env` and passes them to the probe without printing their values. The existing launch plumbing passes them to the local client process; do not archive its process command line. The production launcher builds a release host and serves the already built frontend through `vite preview`. A configured live ACE server, matching local assets, graphical session, and the intended stationary character/camera are required. Check the numeric GPU report to ensure hardware WebGL is active.

Example invocations, after restoring the archive:

```sh
H3D_PROBE_SCRIPT=/tmp/h3d-production-profile-probe.mjs node /tmp/h3d-run-profile.mjs production-profile
H3D_PROBE_SCRIPT=/tmp/h3d-production-ablation-probe.mjs node /tmp/h3d-run-profile.mjs production-ablation
H3D_PROBE_SCRIPT=/tmp/h3d-fragment-cost-probe.mjs node /tmp/h3d-run-profile.mjs fragment-costs
H3D_PROBE_SCRIPT=/tmp/h3d-root-fast-probe.mjs node /tmp/h3d-run-profile.mjs root-fast-costs
H3D_PROBE_SCRIPT=/tmp/h3d-discard-probe.mjs node /tmp/h3d-run-profile.mjs discard-costs
H3D_PROBE_SCRIPT=/tmp/h3d-spatial-probe.mjs node /tmp/h3d-run-profile.mjs spatial-costs
H3D_PROBE_SCRIPT=/tmp/h3d-split-probe.mjs node /tmp/h3d-run-profile.mjs split-costs
H3D_PROBE_SCRIPT=/tmp/h3d-split-clean-probe.mjs node /tmp/h3d-run-profile.mjs split-clean-costs
H3D_PROBE_SCRIPT=/tmp/h3d-clean-program-probe.mjs node /tmp/h3d-run-native.mjs clean-program-costs
H3D_PROBE_SCRIPT=/tmp/h3d-isolated-probe.mjs node /tmp/h3d-run-native.mjs isolated-repeat 0
H3D_PROBE_SCRIPT=/tmp/h3d-isolated-phased-probe.mjs node /tmp/h3d-run-native.mjs isolated-phased 0
H3D_PROBE_SCRIPT=/tmp/h3d-isolated-telemetry-probe.mjs node /tmp/h3d-run-native.mjs isolated-telemetry 0
H3D_PROBE_SCRIPT=/tmp/h3d-readback-transition-probe.mjs node /tmp/h3d-run-native.mjs readback-transition 0
H3D_PROBE_SCRIPT=/tmp/h3d-staged-readback-probe.mjs node /tmp/h3d-run-native.mjs staged-readback 0
H3D_PROBE_SCRIPT=/tmp/h3d-predicate-cost-probe.mjs node /tmp/h3d-run-native.mjs predicate-cost 0
H3D_PROBE_SCRIPT=/tmp/h3d-interpolated-depth-probe.mjs node /tmp/h3d-run-native.mjs interpolated-depth 0
H3D_PROBE_SCRIPT=/tmp/h3d-live-interpolated-probe.mjs node /tmp/h3d-run-native.mjs live-interpolated 1
H3D_PROBE_SCRIPT=/tmp/h3d-depth-precision-probe.mjs node /tmp/h3d-run-native.mjs depth-precision 0
H3D_PROBE_SCRIPT=/tmp/h3d-emitter-audit-probe.mjs node /tmp/h3d-run-profile.mjs emitter-audit
H3D_PROBE_SCRIPT=/tmp/h3d-distance-cutoff-probe.mjs node /tmp/h3d-run-profile.mjs distance-cutoff-experiment
```

The later synthetic boundary fixture needs no credentials, content host, or server. Restore its standalone fixture and validator, then run the same Electron binary (a visible diagnostic window opens and closes automatically):

```sh
python3 - <<'PYRESTORE'
from pathlib import Path
import tarfile
bundle = Path('docs/plans/evidence/world-particle-performance-2026-10-16/depth-boundary-probes.tar.gz')
with tarfile.open(bundle) as archive:
    for member in archive.getmembers():
        if member.name != Path(member.name).name:
            raise RuntimeError('Unexpected archive member path')
        text = archive.extractfile(member).read().decode()
        text = text.replace('/home/me/code/holtburger', str(Path.cwd()))
        (Path('/tmp') / member.name).write_text(text)
PYRESTORE
apps/holtburger-3d/node_modules/.bin/electron /tmp/h3d-depth-boundary-main.cjs
```

The result is written to `/tmp/h3d-depth-boundary-result.json`. Re-run in a fresh process to check repeatability. From the repository root, `python3 /tmp/h3d-validate-boundary.py` validates the retained captures, discard-mask agreement, controls, source hashes, and archived source syntax; it deliberately confirms the candidate failure rather than asserting equality between original and candidate. The extractor records current production GLSL hashes and fails if the expected template, arrival capacity, envelope encoding, or metadata layout changes. These archived scripts reproduce the failed candidate, not a production implementation.

Restore `cpu-diagnostic-probes.tar.gz` using the same basename/path-replacement procedure for the standalone boundary fixture. After the earlier launcher/credential runner has been restored, the CPU probes run as follows:

```sh
H3D_PROBE_SCRIPT=/tmp/h3d-cpu-shadow-probe.mjs node /tmp/h3d-run-native.mjs cpu-shadow 1
H3D_PROBE_SCRIPT=/tmp/h3d-cpu-work-audit-probe.mjs node /tmp/h3d-run-native.mjs cpu-work-audit 1
python3 /tmp/h3d-validate-cpu.py
```

The first command requires the original `shadow-maps` setting, alternates modes, and explicitly persists restoration before exit. It uses the existing production build; rebuild it if source changes and regenerate the analyzer's hashed-bundle symbol mapping. The second command uses Vite development to import diagnostic classes, explicitly selects/persists the original mapped mode, and collects counts without timing claims. Avoid heavy analysis/builds during timing windows. The numeric validator reads retained evidence; the analyzer uses raw `/tmp` profiles/trials from a fresh capture and requires matching production assets. The archive's `captured` variant is provenance for the measured run, not the recommended launcher because its final preference write was not awaited. Historical probes and validators assume the recorded baseline revision and source hashes; the implemented query API intentionally changes those assumptions. Run them against that revision rather than changing historical hashes to match the fix.

Restore `shadow-filter-probes.tar.gz` using the same basename/path-replacement procedure. It includes the original scene source, the disposable build transform with its embedded original selection loop, paired/count/proof probe, ordinary production probe, and standalone evidence validator. With the earlier launcher and credential runner restored:

```sh
npm --prefix apps/holtburger-3d run build -- --config /tmp/h3d-shadow-filter-vite.config.mjs
H3D_PROBE_SCRIPT=/tmp/h3d-shadow-filter-probe.mjs node /tmp/h3d-run-native.mjs shadow-filter 1
npm --prefix apps/holtburger-3d run build
H3D_PROBE_SCRIPT=/tmp/h3d-shadow-filter-production-probe.mjs node /tmp/h3d-run-native.mjs shadow-filter-production 1
npm --prefix apps/holtburger-3d run harness:browser -- --fixture outdoor-pssm --gpu --full-report
python3 /tmp/h3d-validate-shadow-filter.py
```

The paired probe requires mapped shadows initially and restores the saved setting before exit. Its timing runs take approximately three minutes after startup. The last command needs no credentials or graphical session: it validates all retained artifact hashes, the five current production source hashes, exact-proof results, count invariants, timing summaries, sanitation shape, GPU-fixture evidence, and ordinary-production context. Source hashes deliberately fail after subsequent production edits; retain this implementation patch/revision when reproducing. No diagnostic build or profiling hook is installed in the ordinary production app.

For the broader admission audit, restore `late-admission-probes.tar.gz` using the same basename/path-replacement procedure. It contains a separate disposable build transform, native launcher/live probe, frozen composition fixture, preserver, and validator. The fixture uses Vite's server-side module loader with its network WebSocket disabled; it needs neither credentials nor a graphical session. From the repository root:

```sh
npm --prefix apps/holtburger-3d run build -- --config /tmp/h3d-late-admission-vite.config.mjs
H3D_PROBE_SCRIPT=/tmp/h3d-late-admission-probe.mjs node /tmp/h3d-run-native.mjs late-admission 1
node /tmp/h3d-late-admission-fixture.mjs
python3 /tmp/h3d-validate-late-admission.py
```

The live probe toggles only the shadow mode for its six count windows and 30 timing windows, restores the original saved graphics settings, and leaves the normal `dist` build untouched. The frozen fixture verifies the class-admission change in the preparation/resolver composition; it does not implement or test the proposed boolean geometry query. The first fixture attempt passed its cases but emitted a sandbox-denied Vite hot-reload WebSocket warning; explicitly disabling that unused listener produced a clean successful rerun. The retained source uses the corrected configuration. The validator checks all retained artifact hashes, 11 source hashes, normalized capture assumptions, all fixed cases, and cleanup/sanitation records. Its source hashes refer to the first fix's working tree. Fresh raw results are written to `/tmp/h3d-late-admission.json` and `/tmp/h3d-late-admission-fixture.json`; the preserver aggregates and sanitizes them before replacing retained evidence.

The latest implemented follow-ups use `followup-probes.tar.gz`. Unlike the earlier flat archives, it also contains `original/` members holding the exact five pre-follow-up source snapshots. Restore it explicitly:

```sh
python3 - <<'PYRESTORE'
from pathlib import Path, PurePosixPath
import tarfile

original = Path('/tmp/h3d-followup-original')
original.mkdir(exist_ok=True)
bundle = Path('docs/plans/evidence/world-particle-performance-2026-10-16/followup-probes.tar.gz')
with tarfile.open(bundle) as archive:
    for member in archive.getmembers():
        parts = PurePosixPath(member.name).parts
        if not member.isfile():
            raise RuntimeError('Unexpected non-file member')
        if len(parts) == 1:
            target = Path('/tmp') / parts[0]
        elif len(parts) == 2 and parts[0] == 'original':
            target = original / parts[1]
        else:
            raise RuntimeError('Unexpected member path')
        source = archive.extractfile(member).read().decode()
        source = source.replace('/home/me/code/holtburger', str(Path.cwd()))
        target.write_text(source)
PYRESTORE
npm --prefix apps/holtburger-3d run build -- --config /tmp/h3d-followup-vite.config.mjs
H3D_PROBE_SCRIPT=/tmp/h3d-followup-probe.mjs node /tmp/h3d-run-native.mjs followup 1
node /tmp/h3d-followup-fixture.mjs
npm --prefix apps/holtburger-3d run build
H3D_PROBE_SCRIPT=/tmp/h3d-followup-production-probe.mjs node /tmp/h3d-run-native.mjs followup-production 1
python3 /tmp/h3d-validate-followup.py
```

The comparison takes roughly five minutes after startup and requires a matching implemented source tree. It restores graphics preferences and hooks before disconnecting. The normal production probe checks that all earlier/current diagnostic class globals are absent. The standalone validator reads retained evidence, verifies all artifact hashes and eight current production source hashes, and explicitly confirms the reproduced portal failure rather than asserting that every GPU fixture passed. Historical validators/probes retain their original source/API assumptions; use the matching retained patch or the latest validator, rather than updating old hashes to conceal the cutover.

The canonical GPU commands used `--fixture outdoor-pssm`, `--fixture entity-selection`, and `--fixture portal-scope-atlas`, each with `--gpu --full-report`. The portal command failed on both current runs and the baseline control. For that baseline control, `npm --prefix apps/holtburger-3d run dev:vite -- --config /tmp/h3d-followup-baseline-vite.config.mjs` serves the preserved sources. Pass its reported port to the canonical harness with `--vite-port <port>` so the harness reuses that server. Stop it after capture. The archived `h3d-followup-gpu-evidence.py <port>` extracts the two successful numeric reports and three failure payloads from the recorded `/tmp/h3d-followup-gpu-*.log` names; it deliberately requires the observed identical failure. It is a capture-specific extractor, not a portable expectation that another backend must fail. The summary also preserves the measured/rebuilt JS-asset equality record. `h3d-preserve-followup.py` aggregates and sanitizes complete raw captures; do not invoke it on partial runs.

Run one at a time. Specialized probes use fixed `/tmp/h3d-...` output names; the runner label controls generic baseline outputs but does not rename those specialized outputs. Some original broad variant probes take roughly two minutes, independent of the runner's startup timeout setting. Review their hooks before adapting them to a changed renderer. The initial documentation pass preserved the earlier captures. The spatial follow-up then added 45 live timing windows, 45 envelope checks, and six layer-count frames; all three live sessions disconnected after capture. The native follow-up added a 20-window driver-dump run, a valid 15-window clean-program comparison, and one accepted desktop replay baseline. The frozen GLES follow-up added six successful sessions with 278 accepted timing windows, including two same-frame phased comparisons and read-only telemetry. The later readback/depth investigation resolves the control-timing anomaly and archives corrected experiments plus a live candidate comparison. The older `isolated-*` expanded comparisons intentionally retain direct-readback behavior for provenance; use the `staged-readback`, `predicate-cost`, and `interpolated-depth` sources for subsequent measurement. Telemetry sources target this laptop’s `card1` sysfs paths; adapt those paths explicitly on another machine. Failed capture/replay attempts are described above; their numbers are excluded. The native capture/replay scripts require the separately obtained RenderDoc runtime and are archived as diagnostics, not recommended as an unattended replay command after the observed context loss.

For independent asset verification, the original export commands were:

```sh
cargo run -q -p holtburger-tools --bin dat-tool -- export dats/assets.hba 0x01003fa7 --namespace eor/portal --output /tmp/h3d-gloom-mesh.dat
cargo run -q -p holtburger-tools --bin dat-tool -- export dats/retail/client_portal.dat 0x01003fa7 --output /tmp/h3d-retail-gloom-mesh.dat
sha256sum /tmp/h3d-gloom-mesh.dat /tmp/h3d-retail-gloom-mesh.dat
```

Compressed JSON and CPU profiles can be expanded with `gzip -dc`. The profile pairs must be normalized by their own captured frame counts when comparing sampled CPU costs. Use the complete trial files to revisit aggregation choices rather than treating rounded values in this document as a permanent performance budget.


The two-program spatial follow-up uses `two-way-probes.tar.gz` with the same basename-only restore procedure. Its live/frozen probes consume an ordinary current production build; restore the existing production launcher and credential runner from the earlier archives. Run only profile mode:

```sh
H3D_PROBE_SCRIPT=/tmp/h3d-two-way-probe.mjs node /tmp/h3d-run-native.mjs two-way 1
H3D_PROBE_SCRIPT=/tmp/h3d-two-way-live-probe.mjs node /tmp/h3d-run-native.mjs two-way-live 1
apps/holtburger-3d/node_modules/.bin/electron /tmp/h3d-two-way-boundary-main.cjs
python3 /tmp/h3d-validate-two-way.py
```

The frozen probe pauses rendering after capture; it disconnects automatically. The live probe restores its GL hooks before disconnecting. Both expect 206 dominant root-owned draws and reject a changed workload contract. The standalone boundary fixture needs no credentials/assets/server, writes `/tmp/h3d-two-way-boundary-result.json`, and can be repeated in a fresh process. The validator checks the retained captures, manifest/source/build hashes, same-output comparisons, negative controls, exact logical/physical draw counts, cleanup and the passing opacity control. It validates the recorded evidence; it is not a portable assertion that another camera/device produces these timings or pixel counts.

For the independent portal-oracle control, start `npm --prefix apps/holtburger-3d run dev:vite -- --config /tmp/h3d-portal-opacity-vite.config.mjs`, then pass its reported port to `npm --prefix apps/holtburger-3d run harness:browser -- --fixture portal-scope-atlas --gpu --full-report --vite-port <port>`. This transform changes only the served fixture uniform initialization. Stop the isolated Vite server after capture. Historical validators still confirm the original failure; the new control establishes its cause without rewriting old results.
