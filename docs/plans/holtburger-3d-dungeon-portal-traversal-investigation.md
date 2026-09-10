# Dungeon CPU portal traversal preprocessing investigation

2026-09-09. All host runs used debug (`dev`, unoptimized + debuginfo), including the actual Electron client. Production rectangle cutover is now authorized and implemented; current validation is recorded below. Character login was passive, without movement or teleport commands. Earlier sections preserve the investigation chronology and their then-current scope.

Current outcome: production rectangles, per-view aperture/near-result reuse, and independent CPU/GPU depth policy are implemented. The original browser camera measures 794 uncapped FPS; planning fell from about 2.65 ms to 0.54 ms. See **Authorized production cutover** for the current contract and validation.

## Established context and evidence

Character +Holtmage is in cell `0x01f50247`, landblock `0x01f5ffff`, at AC coordinates `(5.2749004, -125.3317719, 7.4809999)`. Actual third-person camera settled in cell `0x01f50243`.

The dungeon has 549 cells in 84 visibility islands. The player's island has 420 cells. Of 1,692 directed crossings, 1,500 are classified depth-continuous; 168 fail source/target cell-bounds halfspace proofs and 24 fail source exact-match. Island merging is working. However, internal island crossings still require full CPU aperture traversal and increment the CPU depth counter. They are excluded only from GPU crossing propagation.

Both captured production views exhaust the 240,181-operation CPU projection budget at completed depth 9, before the depth-16 limit. Neither incurs a GPU frontier retreat. The browser view admits 135 cells and 44 GPU crossings; the live client admits 85 cells and 18 GPU crossings. A budget counter can exceed its limit by the rejected charged operation before throwing.

A browser-only override raised the projection budget to 2,401,810, leaving all other capacities unchanged. The same view then completed at depth 12 with 150 cells, 60 crossings, and only 251,164 operations (4.57% above the original cap). The conspicuous upper-right cavern hole fills with missing roof/wall geometry. No truncation, GPU retreat, or browser errors. Thus CPU work-budget truncation is directly proven for this view; increasing portal depth alone would not repair it.

## Performance

Browser GPU: AMD Radeon RX 7900 XT, RADV through ANGLE/Vulkan. Render scale 1. Browser: 1280x720, six-second steady measurement windows. Actual client: 1442x904, approximately ten seconds. One attribution capture per configuration; these are not repeated benchmark claims.

| Capture                  | Renderer CPU mean | CPU portal planning | GPU measured total | GPU portal composition |
| ------------------------ | ----------------: | ------------------: | -----------------: | ---------------------: |
| Actual debug client      |           3.89 ms |             2.66 ms |            0.74 ms |                0.27 ms |
| Browser standard budget  |           3.35 ms |             2.67 ms |            1.47 ms |                0.33 ms |
| Browser increased budget |           3.32 ms |             2.64 ms |            1.84 ms |                0.56 ms |
| Browser flat control     |           3.13 ms |                0 ms |            2.59 ms |                   0 ms |

Actual client: 65 visible dynamic entities, 233 object draws, 68 particle batches, 4.49 ms mean frame work, about 144 displayed FPS and 216 estimated uncapped FPS. User reports other dungeons often exceed 400 FPS on this machine; that comparison was not independently captured here. A 400 FPS frame has a 2.5 ms budget: portal planning alone exceeds it. The displayed rate includes pacing and must not be read as the inverse of measured CPU work. GPU totals sum instrumented elapsed spans, not frame wall time.

Chrome's native CPU profiler independently identifies polygon normalization, homogeneous/NDC/spatial clipping, near-plane aperture tests, projection metering, and window intersection. In the browser baseline normalizePolygon alone accounts for approximately 0.66 ms self-time per frame. Portal planning consumes about 68% of actual-client renderer CPU time.

Flat rendering eliminates clipping but increases geometry preparation/submission and GPU cost. It is not a general solution. The tiny CPU difference between standard and increased-budget captures is not evidence of a speed improvement.

A complete plan runs 16 GPU propagation rounds, versus 9 for the truncated baseline. The planner uses min(fixed path-depth bound, selected crossing count), not CPU completion depth. This explains the measured GPU composition increase after restoring geometry. CPU reachability depth is not necessarily a safe bound on all per-pixel paths; do not substitute it blindly.

## Source pointers and direction

- `apps/holtburger-3d/host/src/interior_seam.rs:41`: seam proof.
- `apps/holtburger-3d/host/src/env_cell_source.rs`: resolve_cell_island_ordinals, union-find island formation.
- `apps/holtburger-3d/src/lib/game/renderer/portal-render-capacity-policy.ts`: PORTAL_RENDER_CAPACITY_POLICY, fixed limits.
- `apps/holtburger-3d/src/lib/game/renderer/portal-scope-window-culler.ts:836`: depth cutoff and atomic frontier truncation; :1132 excludes internal island crossings from GPU; :1220 increments CPU depth for every crossing; :1229 charges projection work.
- `apps/holtburger-3d/src/lib/game/renderer/portal-window-arena.ts:1530`: normalization hotspot.
- `apps/holtburger-3d/src/lib/game/renderer/portal-scope-atlas-planner.ts:634`: GPU propagation bound.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts:1791`: planning invoked each render.

A modest projection-budget increase restores this particular view but does not address the structural CPU cost or guarantee other orientations fit. Investigate conservative island-level visibility that avoids exact path-window clipping across every internal cell seam, while preserving true topology boundaries and proving image correctness. Separate CPU traversal/work limits from GPU boundary-depth semantics. Evaluate safe tighter GPU propagation bounds independently. Expose truncation reasons distinctly so projection work, depth, and GPU capacity are not conflated.

Retail inspected: `acclient-eor-source/acclient.c:335978` (grab_visible_cells), :441813 (ClipPortals). Retail uses authored visible-cell lists before traversal. Existing documented census evidence shows those lists cannot simply be substituted as a no-regression hard filter. No retail behavior changes made.

## Reproduction

From apps/holtburger-3d:

```sh
npm run harness:browser -- --brief --gpu --profile-renderer --measure-ms 6000 --render-scale 1 --landblock 0x01f50247 --env-cell-radius 0 --explicit-object-radius 0 --env-cell-camera 0x01f50247 --env-cell-position 197.2749,9.081,-46914.6682 --camera-yaw 61 --camera-pitch 0 --frame-mode portal --screenshot /tmp/holtburger-dungeon-portal.png --cpu-profile /tmp/holtburger-dungeon-portal.cpuprofile
```

Use the cell ID as the scene-interest target. Outdoor landblock targeting did not load the dungeon closure; two failed setup runs reporting unavailable root were excluded from evidence.

Artifacts under /tmp:

- holtburger-dungeon-client.json / .png / .cpuprofile: live debug client.
- holtburger-dungeon-portal.json / .png / .cpuprofile: standard browser.
- holtburger-dungeon-budget.json / .png: increased projection allowance.
- holtburger-dungeon-flat.json / .png / .cpuprofile: flat control.
- holtburger-dungeon-archive.json and holtburger-dungeon-manifest.json: content export and decoded manifest.
- holtburger-dungeon-investigation.mjs: disposable harness with CDP response override. Temporarily place beside browser-harness.mjs to resolve imports when rerunning, then remove.

No TUI, movement commands, staging, commits, or retained source edits. Credentials were read from apps/holtburger-3d/.dev.env without printing their values.

## Uncapped follow-up

The first live-client capture was VSync-limited. Its displayed 144 FPS is a pacing ceiling, not a throughput measurement. The HUD second value (approximately 216 FPS) is a smoothed estimate from work time plus excess callback delay. Follow-up runs disable GPU VSync and Chromium frame limiting through Electron commandLine in the disposable generated main.js; the original generated file was restored. Passing those switches as launch arguments failed because the application entry parser treated an unconsumed switch as the entry name.

The first uncapped attempt through Electron commandLine reached the client but the FPS sampler aborted with `Animation-frame timestamps must increase.` Duplicate rAF timestamps are rejected at frame-rate-sampler.ts:94. A probe-only CDP response replacement sets the sampler animation timestamp to its actual callback-start timestamp. This changes FPS diagnostics only. Throughput is computed independently from sampledFrameCount / measuredWindowMs, not the sampler estimate. No sampler changes remain.

## Valid uncapped measurement

The final capture disables Electron GPU VSync and Chromium frame limiting and disables all opt-in renderer/CPU profiling. Debug host retained. Measured **2,419 rendered frames / 10.056 seconds = 240.55 FPS**, with 3.756 ms mean instrumented frame work. This is actual wall-time throughput, not the HUD estimate. Approximately 40% below the user-reported 400 FPS comparison (no reference dungeon benchmark performed). Report: `/tmp/holtburger-dungeon-uncapped-clean.json`; screenshot: `/tmp/holtburger-dungeon-uncapped-clean.png`.

The same view selects 85 cells and 18 GPU crossings, completes depth 9, charges 240,251 projection operations, reports one truncated view and zero GPU retreats. No browser errors. Thus removing pacing and profiler overhead does not change the visibility diagnosis.

The temporary diagnostic sampler used callback start timestamps and ignored duplicate/non-increasing start-time samples (possible during very fast startup frames). This did not skip renderer frames. The independent performance-bridge frame count above is the throughput numerator. The served-response reload attempt stalled; the successful run applied the diagnostic adaptation to the local sampler before launch. Both the sampler source and generated Electron main.js were restored byte-for-byte afterward. Temporary scripts were removed from the repository and copied to /tmp. Git status returned to the original two submodule untracked-content markers.

## Scope and constraints for the next investigation

Historical scope at investigation start (superseded by the authorized cutover below): user authorized this document and diagnostic experiments, not a production cutover. Preserve debug builds, real-GPU measurement, render scale and workload identity. No movement of the saved character is needed. No commits or staging. Production changes from experiments must be restored; retain reusable diagnostics only when they justify their size.

The current truncated image is not a correctness oracle. Compare changes against a completed reference with enough CPU work allowance, then separately measure production-capacity effects. Preserve near-plane straddles, reciprocal suppression, non-Euclidean boundaries, topology revisions, and dynamic object selection. A CPU work optimization changes which frontier fits: report image/selection and operation counts together. Do not confuse reduced metering with reduced actual work.

## Investigation threads

| Thread                                    | Hypothesis                                                                             | First experiment                                                                                                     | Acceptance / rejection evidence                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A. Compile larger visibility regions      | Some internal cell boundaries can be removed before camera traversal                   | Census island geometry, internal seams, and boundary exits; identify which stronger geometric proof is needed        | Demonstrate a sound merge criterion and count how many crossings it actually removes; island membership alone is insufficient |
| B. Precompute coarse aperture tests       | Most expensive near-volume triangle clips can be rejected using static aperture bounds | Carry existing host-produced aperture bounds into preparation; compare coarse rejection against exact classification | No false negatives; count exact clips avoided, added tests, and CPU effect                                                    |
| C. Compute camera facts once per aperture | Repeated routes redo identical facing/near-volume classification                       | Replay completed culls with per-view classification reuse and compare full selected-window output                    | Identical completed output; classify unique vs repeated inputs; measure actual work separately from compatibility budget      |
| D. Retain unchanged visibility plans      | Stationary camera repeatedly rebuilds a static plan                                    | Audit every input and mutable output lifetime; measure consecutive identical inputs                                  | Explicit complete invalidation contract; benefit under moving camera reported separately                                      |
| E. Precompute portal-pair rejection       | Static geometry rules out many outgoing transitions from a given incoming aperture     | Derive sound ray/halfspace rejection and census candidate pairs                                                      | No authored-PVS assumptions; meaningful rejection rate without excessive preprocessing/storage                                |
| F. Separate CPU and GPU limits            | Shared depth knob conflates cell traversal with compositor crossings                   | Trace depth inside/outside islands and current GPU round selection                                                   | A sound independent bound; no substitution of BFS completion depth for per-pixel path length                                  |

| G. Preserve normalized fragments | Copying canonical fragments repeats normalization | Prove source normalization invariants and measure a normalized-copy path | Exact completed output, including merged fragments; measured normalization work removed |
| H. Conservative rectangular windows | Less precise CPU clipping can trade extra GPU work for lower planning cost | Replace inherited multipart windows with enclosing screen-space rectangles in a diagnostic traversal | Conservative candidate coverage, correct final images, and lower total frame cost without capacity-induced omissions |

## Initial code audit

Topology indexing already precomputes integer cell adjacency, reciprocal crossing indices, source coordinates, prepared apertures, and island ordinals. Rebuilding those structures is not the observed hot path. Window projection has an existing per-frame cache that promotes an ordinary crossing on its third use. Facing and near-volume classification still happen on each route expansion before that cache is consulted. The near-volume classifier copies aperture vertices and clips each triangle against the camera volume; this is a promising place to test conservative static bounds and per-view reuse.

Static topology, prepared aperture geometry, and allocated buffers carry over between frames. Camera-dependent projection-cache entries and scope-window coverage do not: `PortalWindowArena.reset` calls `projectionCache.beginFrame`, and the culler reconstructs windows on every render, even for an unchanged view.

The pipeline resets active view state each frame; atlas/culler outputs are arena-backed mutable views. Whole-plan reuse therefore requires explicit lifetime work rather than retaining a returned object and assuming it is immutable.

## Experiment log

Experiments below should record hypotheses, commands, workload, observations, limitations, and next decisions. Keep rejected ideas and their concrete rejection evidence when that prevents repeating work.

### 2026-09-09 — B/C: existing bounds and per-view near-volume reuse

The retained diagnostic is `apps/holtburger-3d/src/harness/browser/portal-traversal-investigation.ts`, loaded only when the browser harness has `HOLTBURGER_PROBE_PORTAL_TRAVERSAL=1`. It captures one production topology/input pair, replays a separate culler synchronously, restores the near-volume method afterward, and never installs candidate visibility into the renderer. It checks complete selected scope/window coordinates and crossing/straddle output for exact equality. The production render remains unchanged.

Important correction to the initial hypothesis: `ScenePortalAperture.landblockBounds` already contains host-produced bounds. `PreparedPortalApertureProjectionInput` narrows that shape to `PlanarAperture`, which has vertices/indices/plane but no bounds. Thread B therefore needs to propagate an existing owned fact, not compute another copy at frame time or invent a new host contract. The first probe derived equivalent bounds from vertices; subsequent probes read existing scene bounds directly.

A bounding box is rejected only if its minimum signed distance lies outside one near-volume clipping plane by more than `NEAR_CLIP_CONTACT_EPSILON`. This is a conservative halfspace test: uncertain boxes fall through to the exact triangle classifier. During evidence collection every proposed bounds rejection is checked against that exact classifier. Production promotion still needs explicit grazing/roundoff, transformed-landblock, and synthetic differential coverage beyond these real poses.

Completed reference uses 2,401,810 allowed projection operations, with depth and other limits unchanged. Each replay timing sample averages ten culls; six samples per variant rotate execution order. These are CPU replay measurements, not FPS or end-to-end speedup claims. Diagnostic Map/Set bookkeeping is included. Reuse and bounds bypass old exact-test meter charges, while the new coarse tests have no production accounting yet: no production-capacity equivalence is asserted. A production proposal must decide whether to preserve the existing oracle budget or deliberately revise that contract and its tests.

| Yaw  | Completed cells / crossings / depth | Near calls / unique apertures | Bounds-only exact tests | Bounds + reuse exact tests | Median reference / combined replay |
| ---- | ----------------------------------- | ----------------------------- | ----------------------- | -------------------------- | ---------------------------------- |
| 61°  | 150 / 60 / 12                       | 1,879 / 510                   | 29                      | 21                         | 2.925 / 2.555 ms                   |
| 151° | 112 / 46 / 12                       | 1,943 / 389                   | 6                       | 6                          | 2.955 / 2.560 ms                   |

At 61°, reference replay samples span 2.91–3.12 ms and combined samples span 2.54–2.56 ms. At 151°, see the machine-readable artifact for the exact spread. Both poses preserve the complete output, with one true near-volume intersection in each. Bounds eliminate 98.5% and 99.7% of exact classifier calls respectively. Combined median replay improvement is approximately 13%; most clipping/normalization work remains.

Reference trace at 61°: 2,468 outgoing edge visits, 590 queue items, 1,106 route projections, 1,879 near classifications, 1,878 facing tests. Existing projection cache: 428 hits, 172 promotions, 505 cold bypasses. The immutable-oracle meter charges 251,164 operations but records 220,105 executed projection primitives; the distinction already exists and must survive any optimization.

Reproduce from `apps/holtburger-3d`:

```sh
HOLTBURGER_PROBE_PORTAL_TRAVERSAL=1 npm run harness:browser -- --brief --gpu --measure-ms 1000 --render-scale 1 --landblock 0x01f50247 --env-cell-radius 0 --explicit-object-radius 0 --env-cell-camera 0x01f50247 --env-cell-position 197.2749,9.081,-46914.6682 --camera-yaw 61 --camera-pitch 0 --frame-mode portal
```

Vary yaw to repeat the other poses. Results are in `portalTraversalInvestigation`; retained local captures are `/tmp/holtburger-traversal-probe-61.json` and `/tmp/holtburger-traversal-probe-151.json`. The diagnostic allocates a separate large reference arena (about 137 MB at this capacity) and is intentionally opt-in. Do not use these replay timings as renderer profiling measurements.

### 2026-09-09 — A: island structure and merge-proof boundary

Archive census of the player's 420-cell island:

- 1,366 internal directed crossings; 80 directed exits distributed across 78 member cells, reaching 79 neighboring islands.
- 1,358 internal crossings individually satisfy the depth-continuous seam proof.
- Eight internal crossings fail `source-cell-crosses-portal-plane`, but are joined through alternate proven paths: bidirectional pairs 0x01f50105 ↔ 0x01f50106/0x01f50107 and 0x01f5011a ↔ 0x01f5011b/0x01f5011c.
- Across the dungeon, 1,580 of 1,698 aperture geometries contain two triangles. Prepared projection already merges triangulation-only edges into convex vertex loops; near-volume classification still consumes triangles.

This sizes a substantial structural opportunity, but also rules out treating union-find membership as sufficient proof for deleting all CPU aperture constraints. A scheduling island is a connected component of accepted seams, not a proven convex visibility volume. The eight failed seam proofs are not themselves proof of incorrect rendering; they are evidence that global island membership and local seam proof are distinct contracts.

Next for A: establish whether proposed compiled regions are convex traversable volumes, or use a conservative region-query scheme with an explicit proof that additional geometry and exit candidates cannot create incorrect visibility/occlusion. Retain original cell membership for dynamic entities even if the traversal graph becomes coarser. Do not promise an island-wide cutover from this census alone.

### 2026-09-09 — D: stationary-plan reuse and ownership audit

At yaw 151°, all 296 adjacent pairs among 297 captured views had identical serialized topology revision plus cull inputs. This is a stationary harness observation, not a moving-client hit-rate claim.

A cull cache key must cover topology identity/revision, root scope, anchor coordinates, clip transform, near-volume eye/corners/planes, drawing-buffer dimensions, footprint policy, and capacity policy. Atlas-plan reuse additionally depends on resource capacities/extents. Do not use topology revision alone across distinct topology owners. Dynamic entities and their poses remain independently queried each frame; their movement does not appear in the static cull input.

`WebGL2PortalScopeAtlasPipeline.beginFrame` clears active view handles but retains each view's planner/arena. The cached plan must be owned by that view's planner, and a new frame must still reinitialize opaque routing and GPU submission state. Returned arena views and crossing streams expire when their owners next prepare: consumers cannot retain an arbitrary old result as an immutable snapshot. No plan-reuse implementation was made.

### 2026-09-09 — G: avoid renormalizing already-normalized fragments

Analytical lead from the sampled normalization hotspot: `PolygonBuilder.copyFragmentFromBuilder` and `copyFragmentFromArena` copy existing fragments, then call `addRawPolygon`, which normalizes again before deduplication. A typed/internal normalized-fragment insertion path may remove repeated normalization while retaining deduplication. This is not load-time preprocessing; it preserves work already done earlier in the same cull. It needs proof that every source path, including merged fragments, satisfies the exact normalization invariant. No timing claim or implementation yet.

### Current direction

H is the next structural experiment: test whether conservative rectangular CPU windows can avoid enough normalization/intersection/fragment-management work to justify more GPU work while the camera moves. This is a hypothesis, not a proven safe replacement. D addresses unchanged views separately; do not use stationary cache hits as evidence of moving-camera performance.

B/C remain measured narrower opportunities. G targets repeated normalization with a smaller proof obligation than A's whole-region compilation. E/F remain open: static portal-pair rejection must prove impossible rays, and GPU depth bounds must remain valid for all admitted per-pixel paths. No production cutover has been made.

### Third orientation and validation

At yaw 331°, completed reference selects 28 cells, eight crossings, five domains, and finishes at depth seven. Near-volume calls fall from 134 to 30 exact clips with bounds plus reuse; 49 are reused and 55 are bounds-rejected. Six true near-volume intersections survive. Every selected window vertex and crossing/straddle result matches exactly. Of 1,146 captured views, all 1,145 adjacent pairs have identical cull inputs.

Reference median replay is 0.255 ms (0.23–0.41 ms across six samples); combined median is 0.240 ms (0.21–0.31 ms). This small difference overlaps substantial timing variation: report it as a correctness and small-workload check, not a confident speedup. Capture: `/tmp/holtburger-traversal-probe-331.json`.

One attempted third-orientation run was invalidated by formatting the probe while Vite was running: the page reloaded and lost its scene-interest state. It failed loudly with unavailable portal root/no captured view, was excluded, and was rerun after edits stopped.

Type checks, ESLint, and Knip pass for the retained diagnostic. Three successful real-GPU/debug-host runs perform completed-reference comparisons in the browser. No asset-dependent permanent tests or production optimization were added. B/C provide measured candidates for a later production proposal; their bounds ownership and work-meter contracts remain unresolved. The next investigation now prioritizes H, with D and G as separate opportunities. A global region merge remains a larger proof task.

### 2026-09-09 — H: trade exact CPU windows for conservative coverage

User raised the possibility of conceding more overdraw to reduce CPU planning. Investigate this explicitly rather than assuming exact multipart window clipping is required at every CPU step. The first harness-only approximation experiment is recorded below.

The proposed first prototype represents inherited visibility coverage as enclosing screen-space rectangles. Intersecting two rectangles requires min/max operations rather than polygon edge clipping and normalization. Taking an enclosing rectangle when routes combine admits gaps between those routes; this is intentional extra candidate coverage, not evidence that the gaps are actually visible. Aperture projection and safe near-plane handling still need work: using rectangles does not automatically remove them.

The approximation must remain outward/conservative. It must never shrink true coverage, and every expansion of accumulated coverage must be propagated to descendants before it can suppress later work as already visited. Footprint rejection needs separate treatment: a rectangle overestimates aperture area and can retain objects/portals that the exact policy would discard. Preserve reciprocal handling and special near-plane behavior; do not project eye-straddling apertures as ordinary finite rectangles without a proof.

Extra candidates can cost more than overdraw:

- Larger windows can admit more cells, crossings, geometry, and traversal revisits, offsetting cheaper clipping.
- Larger atlas tiles and more arrival/crossing records can exhaust fixed capacities. A conservative CPU approximation can still cause missing final geometry if a later capacity retreat removes useful work.
- The GPU evaluates actual portal geometry between render domains, but internal island crossings have no GPU mask. Additional same-island geometry may affect local depth or reveal protruding objects. GPU compositing is therefore not a blanket correctness guarantee for approximate CPU selection.
- Complete-plan propagation already uses a fixed GPU path bound. More admitted work must not silently exceed that bound or justify replacing it with CPU BFS depth.

First experiment and decision criteria:

1. Use the existing completed exact traversal as the reference, with sufficient work allowance; the production truncated view is not the image oracle.
2. Compare conservative candidate coverage and traversal completion, rather than requiring identical selected windows. Record additional cells/crossings and any reference-visible coverage lost.
3. Render both results using the real debug/GPU harness at fixed scale, viewport, content, camera, and reproducible effects. Inspect final image differences around occluders, protruding objects, island boundaries, overlapping spaces, and near-plane crossings. Extra work is acceptable; changed visibility is not implicitly authorized.
4. Measure CPU planning, whole-frame CPU work, GPU opaque/composition time, actual uncapped throughput where practical, selected geometry, atlas area, arrival/triangle capacity use, and every truncation/retreat reason. The decision is total frame cost and correct output, not just faster clipping.
5. Include the three recorded orientations, camera rotation/movement, and representative difficult portal fixtures. Separate stationary results from moving-view results. Repeat comparable measurements and report spread before claiming an improvement.
6. Run both generous-capacity correctness comparisons and current-capacity behavior checks. If rectangular coverage is too broad, use the evidence to decide whether selective exact refinement is warranted; do not preemptively add a second planner or fallback policy.

D and H solve different problems. An unchanged plan can reuse exact results without conceding overdraw, provided all inputs and resource lifetimes match. Rectangular traversal targets views that must be recomputed while the camera moves. Neither has a demonstrated production speedup yet; the H prototype measurements below concern the debug browser harness.

### 2026-09-09 — H prototype: rectangular propagation and per-view aperture reuse

Implemented an opt-in browser-only experiment in `src/harness/browser/portal-rectangle-experiment.ts`; production renderer code and tuning are unchanged. It substitutes enclosing rectangles for inherited windows and accumulated coverage, propagates the entire enlarged rectangle on admission, and caches each exact aperture projection once per view (ordinary and near-ray routes separately). Exact aperture projection and the original near-volume classifier remain. The original GPU planner/compositor consumes the resulting selection. These results therefore combine simpler coverage arithmetic with more aggressive per-view projection reuse; they do not isolate the contribution of either change.

Both comparison modes use the same harness wrappers. Expanded allowance is 2,401,810 projection primitives so the exact oracle completes; original depth, queue, and GPU capacity limits remain. No cross-frame plan reuse is performed. Each rendered frame recomputes traversal even though these captures hold the camera stationary.

Initial paired captures: debug content host (`dev`, unoptimized + debuginfo), real RX 7900 XT via ANGLE/RADV, GPU vsync and frame-rate limit disabled, 1280×720 drawing buffer, scale 1, six-second measurement, renderer profiling enabled, yaw 61/151/331°, original recorded position, effects seed 7 and frozen simulation frame 120. The measurements below are single paired captures, not a confidence interval or live-client FPS prediction.

| Yaw  | Planning exact → rectangles (ms) | Mean frame CPU work (ms) | GPU total (ms) | Selected cells | Crossings / domains | Atlas pixels          |
| ---- | -------------------------------- | ------------------------ | -------------- | -------------- | ------------------- | --------------------- |
| 61°  | 2.645 → 1.163                    | 3.431 → 1.916            | 1.772 → 1.403  | 150 → 171      | 60/31 → 84/43       | 1,301,072 → 1,413,808 |
| 151° | 2.653 → 0.811                    | 3.285 → 1.369            | 1.767 → 1.043  | 112 → 113      | 46/24 → 48/25       | 1,387,037 → 1,409,191 |
| 331° | 0.245 → 0.170                    | 0.627 → 0.553            | 0.514 → 0.484  | 28 → 28        | 8/5 → 8/5           | 1,091,306 → 1,093,601 |

Planning reductions are approximately 56%, 69%, and 31%; absolute savings are 1.482, 1.842, and 0.075 ms. Observed samples per nominal six-second interval are 1,723→3,029, 1,798→4,188, and 8,746→9,807 (roughly 287→505, 300→698, and 1,458→1,635 frames/s). Those are approximate uncapped harness throughputs: the report does not timestamp the exact observation interval, and subsequent reporting can add frames. They are not reciprocals of CPU work, nor measured live-client FPS. The prior live-client measurement remains separate.

At 61°, composition GPU time rises 0.561→0.620 ms, consistent with more admitted portal work. Opaque GPU time instead falls 1.058→0.635 ms despite more submitted geometry. The latter is an observation under different CPU submission cadence, not proof rectangles intrinsically make opaque rendering cheaper; do not extrapolate it to a GPU-bound machine. CPU and GPU spans overlap and must not be summed into frame time.

A useful structural surprise: at 61°, route projections decline 1,106→894 and outgoing crossing inputs 2,468→1,954 despite additional selected cells. Coarser coverage consolidates routes sooner. The candidate performs 312 exact aperture projections, reuses 582 results, makes 846 rectangle intersections, and admits 485 rectangles. Its projection meter reports 76,646 versus exact 251,164, but this is **not an apples-to-apples operation count**: diagnostic rectangle operations/cache hits are not charged to the original work meter. A production work-meter contract remains necessary. Existing arena trace counters also omit the prototype's separate allocating rectangle arrays/maps.

All three exact references and candidates complete, and rendered frames report zero frontier retreats/truncated views. Every reference-selected cell appears in the candidate. However, strict coverage and image equivalence are **not yet proven**:

- Exact window vertices outside candidate rectangles: 9 at 61°, 2 at 151°, 3 at 331°. The largest 61° miss is 7.54e-6 NDC vertically, approximately 0.00272 drawing-buffer pixels. These failures remain visible in the report; they have not been hidden by widening the comparison tolerance.
- The exact clipper classifies unnormalized signed edge cross-products against `-PORTAL_WINDOW_NDC_EPSILON`, rather than using strict half-planes. Its accepted distance varies with edge length. A mathematically enclosing rectangle is therefore not automatically a superset of every tolerance-expanded exact result. A numerical conservativeness policy needs proof; arbitrary padding tuned to these poses would not supply it.
- Captured PNGs are 1280×633. Pixel comparisons find 455 changed pixels at 61° (22 exceed 16 channel levels; maximum 48), 288 at 151° (3 exceed 16; maximum 47), and 181 at 331° (maximum 1). At 61° mean absolute channel error is 0.000780/255; at 151° it is 0.000209/255. The rendered cavern has no gross missing-region discrepancy in the inspected 61° image/difference, but the sparse changes are not yet attributed to rasterization, AO, effects, or changed visibility. Low average error is not a correctness proof.

Reproduce from the app directory (switch mode to `rectangles`, budget to `current`, or yaw as needed):

```sh
HOLTBURGER_PROBE_PORTAL_RECTANGLES=exact HOLTBURGER_PROBE_PORTAL_BUDGET=expanded \
  npm run harness:browser -- --brief --gpu --profile-renderer --measure-ms 6000 \
  --render-scale 1 --landblock 0x01f50247 --env-cell-radius 0 --explicit-object-radius 0 \
  --env-cell-camera 0x01f50247 --env-cell-position 197.2749,9.081,-46914.6682 \
  --camera-yaw 61 --camera-pitch 0 --frame-mode portal --particle-seed 7 \
  --frame-interval-ms 16 --capture-frame 120 --screenshot /tmp/portal-rectangle.png
```

Raw local evidence: `/tmp/holtburger-rect-exact-61.json`, `/tmp/holtburger-rect-candidate-61.json`, and `/tmp/holtburger-rect-{exact,rectangles}-{151,331}.json`, with corresponding PNGs. The opt-in report contains selection, reference containment failures, work counters, and current/expanded budget identification.

Decision: the measured CPU opportunity merits further work, but this is an experiment, not a production-ready optimization. Next correctness work is outward numerical bounds, attribution of sparse pixel differences, moving/near-plane and overlapping-space fixtures, then capacity stress. Performance follow-up should isolate reuse from rectangle propagation and collect alternating repetitions. Stationary captures recompute every frame and demonstrate computation cost; they do not establish moving-camera correctness or cross-frame cache hit rates.

A reverse-order repeat at 61° measured exact planning 2.690 ms versus rectangles 1.148 ms, with frame CPU work 3.430 versus 1.893 ms. Across the two captures per mode, exact planning spans 2.645–2.690 ms and rectangles 1.148–1.163 ms (approximately 56–57% reduction). This repeat ran rectangles with the **current** work allowance: it still completed depth 13, selected the same 171 cells, and had zero GPU frontier retreats. The expanded exact repeat completed depth 12 with 150 cells. Throughput samples were 1,728 exact and 3,073 rectangular per nominal six-second window. Captures: `/tmp/holtburger-rect-{exact,rectangles}-repeat-61.json` and PNGs. The unchanged rectangular result under current allowance is useful operational evidence, but does not resolve the missing rectangle-operation accounting described above.

Validation after the experiment: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, selected-file Prettier checks, and `git diff --check` pass. Eight debug/real-GPU captures completed. No production source changes or commits were made.

### 2026-09-09 — H follow-up: sweep, ablation, numerical counterexample, and new profile

The follow-up remains entirely harness-local. `HOLTBURGER_PROBE_PORTAL_RECTANGLES` now accepts `rectangles-uncached` to remove projected-aperture reuse while keeping the same rectangle algorithm, and `rectangles-near-reuse` to additionally reuse exact finite-near-volume classifications within each view. The latter does not add coarse bounds rejection. Comparison replay checks reused classifications against the original method, outside timed rendering. `HOLTBURGER_PROBE_PORTAL_SURVEY=1` runs the camera survey before the measurement window, restores the requested pose, and emits `portalRectangleSurvey`. Comparison cullers now retain their arenas between survey poses rather than allocating two large arenas for every pose.

#### Wider camera coverage changes the readiness assessment

Survey: 72 horizontal headings at 5° increments; 24 headings each at pitches -30° and +30°; and 16 nearby-position probes (eight X/Z offsets within ±0.15 world units, at two headings). Total 136 rendered poses. The origin, explicit EnvCell root, viewport, and scene are the same as the initial experiment. Nearby translations deliberately retain the explicit root; this is a local camera-input probe, not a collision-validated cell transition or a continuous live-client movement test.

- All 136 expanded exact references complete. No reference-selected scope is absent from any candidate.
- Rectangles complete in 129 poses and hit **depth 16 / declined depth 17 in seven poses**, under both current and expanded work allowance. Corresponding exact traversals finish at depths 10–13. This establishes a depth-limit issue, not projection-budget exhaustion.
- Failing rectangle orientations (yaw modulo 360, pitch): (106,-30), (121,-30), (31,-30), (46,-30), (106,30), (121,30), (46,30). For example, yaw 121/pitch 30 selects 175 cells/88 crossings with rectangles versus 134/64 exact, and remains truncated.
- Rendered and independent candidate summaries match at every pose; no additional atlas-induced selection reduction was observed in this survey. This is not a universal atlas-capacity proof.
- 114 poses contain at least one exact window vertex outside the rectangular candidate. Worst gap: 0.000102686 NDC horizontally (~0.06572 pixels at width 1280), at yaw 111/pitch 0 in cell 0x01f502d2. Thus the original-view ~0.003-pixel discrepancy did not bound the wider camera set.
- Near-ray route counts range up to eight. Adding near-volume result reuse preserves the entire serialized survey result exactly, including every scope, truncation, and numerical gap. Reused classifications also pass direct exact-method verification during reference comparisons.

Broader coverage can consolidate some routes sooner while also admitting longer spurious routes elsewhere. The initial speedup and this new depth pressure are compatible observations. Increasing the cap alone would not establish image correctness or a valid GPU propagation bound.

Raw evidence: `/tmp/holtburger-rect-survey.json` and `/tmp/holtburger-rect-near-reuse.json`. Neither survey samples other dungeons or validates camera root transitions; those remain required before a production cutover.

#### Isolating aperture reuse

At original yaw 61, expanded allowance, otherwise identical six-second debug/real-GPU captures:

| Variant                       | Planning ms | Mean frame CPU work ms | Exact aperture projections | Projection reuses | Selected cells |
| ----------------------------- | ----------- | ---------------------- | -------------------------- | ----------------- | -------------- |
| Rectangles, no aperture reuse | 2.146       | 2.929                  | 894                        | 0                 | 171            |
| Rectangles, aperture reuse    | 1.145       | 1.886                  | 312                        | 582               | 171            |

The difference is ~1.001 ms (47% of the uncached rectangle planner). This is a conditional ablation within the rectangle implementation, not an additive partition of the total exact→rectangle gain. The earlier exact baseline already has a third-use projection cache, and the harness rectangle adapter projects through a full-screen exact window on each cache miss. These differences prevent interpreting the ablation as the isolated benefit of adding a cache to production exact traversal. It does establish that the rectangle result must not be credited solely to replacing polygon intersections.

Raw captures: `/tmp/holtburger-rect-ablation-{rectangles-uncached,rectangles}.json` and PNGs. Prior exact repeated PNGs are byte-for-pixel identical after decoding, as are prior rectangular repeated PNGs. Near-reuse output is also identical to rectangular output in the original view.

#### Numerical contract: a reproducible counterexample

A temporary asset-independent Vitest probe exercised the production immutable clipper with an identity projection. The clip aperture is the rectangle x=[0,0.1], y=[-0.005,0.005]; the inherited rectangle is x=[-0.00005,0.05] with the same y interval. The aperture's full-screen projection has minimum x=0, but clipping the inherited rectangle retains minimum x=-0.00005. Both assertions passed. Test output is `/tmp/holtburger-rect-numerics-proof.txt`; the temporary probe was removed after execution.

This follows directly from the implementation: the left edge length is 0.01, and the signed cross-product of the outside point is -0.0000005, which is accepted against `-PORTAL_WINDOW_NDC_EPSILON` (-0.000001). The allowed coordinate displacement scales as epsilon/edge length. This is an algorithmic tolerance difference, not merely machine rounding. Full-screen projection followed by strict min/max intersection therefore cannot promise containment of the existing exact clipper, even with perfect arithmetic.

A future conservative bound must account for the actual relaxed half-planes of projected aperture fragments, before route clipping discards their tolerance envelope. Fixed padding selected from observed poses is not a proof. The current adapter only exposes a normalized result already intersected with the full-screen root, which is the wrong ownership boundary for deriving that contract cleanly. Footprint policy also deserves a separate proof: the exact policy sums fragment areas, including any surviving overlaps; a rectangle's area is not universally an upper bound on that sum.

#### Pixel difference attribution

Disabling ambient occlusion in both variants at yaw 61 leaves the comparison unchanged: 455 changed pixels, 22 exceeding 16 channel levels, maximum 48. The strong differences occupy x=836–837, y=268–291 in the captured PNG. Inspection shows a reddish sliver along a wall edge in the exact render that is covered in the rectangular render. Identical repeated same-mode captures rule out run-to-run variation; the AO-disabled pair rules out ambient occlusion. This remains a visibility/rasterization difference of unproven correctness, rather than acceptable shading noise by assumption.

At the depth-truncated yaw 121/pitch 30, the AO-disabled pair differs in 602 pixels, 21 exceeding 16 levels, maximum 47. Every exact-selected scope remains present, but that does not establish equivalent per-pixel output. Evidence: `/tmp/holtburger-rect-noao-{exact,rectangles}-{61,121}.{json,png}`; enlarged original-view edge comparison: `/tmp/holtburger-rect-edge-comparison.png` (exact left, rectangles right).

#### Profile the remaining planner

Native V8 sampling at the restored original pose, after the survey, reports planning 1.354 ms across 2,737 renderer samples. Sampling adds overhead; use the unprofiled-native captures above for performance comparisons. Inclusive sampled times per rendered frame:

| Work                                                                | Inclusive sampled ms/frame |
| ------------------------------------------------------------------- | -------------------------- |
| Rectangle aperture projection adapter                               | 0.695                      |
| Finite near-volume classification                                   | 0.286                      |
| Full-screen exact window intersection inside the projection adapter | 0.230                      |
| Polygon normalization (across its callers)                          | 0.164                      |
| Homogeneous polygon clipping                                        | 0.168                      |

These rows overlap and must not be summed. The adapter's full-screen intersection is harness machinery used to access the original projection, so it is a candidate for removal through a clean projected-aperture contract. Near-volume classification remains meaningful enough to test, but reduced call counts alone are not a demonstrated frame-time win. Sampling source: `/tmp/holtburger-rect-followup.cpuprofile`.

The GPU command ledger still chooses `min(retainedDepthLimit, selectedCrossingCount)`, with a fixed policy maximum of 16 for completed CPU traversals. Strictly increasing per-pixel entry depth supplies a no-repeated-directed-crossing argument and hence a crossing-count bound; it does not independently prove that 16 is sufficient for every admitted ray. Rectangle depth truncation does not resolve this existing proof obligation. No GPU depth-policy change was made.

#### Near-volume reuse: matched warmup and balanced repetitions

The first near-reuse capture (1.158 ms planning) could not fairly establish a gain against a stationary-only baseline, because it had run the full survey before measurement. Two balanced-order pairs now use identical survey warmup, current allowance, six-second debug/real-GPU windows, and no native sampling:

| Pair              | Rectangles planning ms | + near-volume reuse ms | Rectangles frame CPU work ms | + near-volume reuse ms |
| ----------------- | ---------------------- | ---------------------- | ---------------------------- | ---------------------- |
| Normal then reuse | 1.241                  | 1.145                  | 1.973                        | 1.868                  |
| Reuse then normal | 1.258                  | 1.196                  | 2.008                        | 1.944                  |

Near-result reuse saves approximately 5–8% of planning (0.063–0.096 ms) and 3–5% of mean frame CPU work in these pairs. This is a smaller opportunity than projected-aperture reuse, with no additional overdraw. It avoids 916 repeated classifications from 1,469 calls at the original view. The survey and final PNG remain identical. Classification-cache hits still require a production work-accounting policy; the harness does not charge those skipped operations as immutable-oracle work.

Files: `/tmp/holtburger-rect-nearpair-rectangles-{1789004835,1789004936}.json` and `/tmp/holtburger-rect-nearpair-rectangles-near-reuse-{1789004869,1789004903}.json`, with corresponding PNGs.

Priority at this experiment stage (superseded below): establish a reusable projected-aperture contract with an explicit conservative numerical envelope, then resolve the rectangle algorithm's depth behavior and deterministic pixel changes. Near-result reuse is a measured smaller companion. Avoid spending effort optimizing the harness's full-screen projection adapter as though it were an intended production abstraction. Whole-region compilation and unchanged-plan reuse remain separate, deferred threads.

#### Direct test of the user's GPU-depth hypothesis

The user asked whether the image discrepancy could simply be the maximum portal depth. For the original yaw-61 wall edge, CPU traversal already completes at depths 12 exact / 13 rectangular, so CPU truncation cannot explain it. To independently test the GPU bound, an isolated Vite transform raised the served GPU policy maximum from 16 to 256 while explicitly retaining depth 16 in the diagnostic CPU cullers. The normal crossing-count bound then issued **60 GPU propagation steps for exact and 84 for rectangles**, verified by `portalPropagationDrawCount` in the reports. All other camera/content/effect settings match the prior default-AO captures.

Both resulting PNGs are pixel-identical to their respective 16-step baselines: **zero changed pixels for exact and zero for rectangles**. The wall-edge discrepancy survives sufficient propagation for every selected crossing, so the fixed GPU step count does not cause this particular difference. This does not establish that the fixed count is sufficient for all other views or dungeons. The seven CPU-depth-truncated sweep poses remain a distinct issue.

Evidence: `/tmp/holtburger-rect-gpu-depth-{exact,rectangles}.{json,png}`. The temporary transform is `/tmp/holtburger-portal-depth-vite.config.mjs`, which imports the repository Vite config and changes served source only; production files were never edited. The isolated port-14329 Vite server was stopped after the test. CPU selection and depth remain 150/12 exact and 171/13 rectangles.

Validation: type checks and ESLint pass for the extended harness; the temporary numerical proof passed and was removed. Native profiling, the 136-pose sweeps, balanced near-cache repetitions, AO isolation, and the GPU-depth A/B all ran through the debug host on the real GPU. No production optimization, policy change, staging, or commit was made.

### Live visual comparison control (completed experiment; control now removed)

At the user's request, the development client with `--debug` temporarily showed a top-center **Portal comparison** overlay. Exact and Rectangles buttons switch the existing experiment without reconnecting or changing camera/player inputs. Both modes use the expanded projection-work allowance; the depth limit and GPU compositor remain unchanged. Exact is selected initially. A cold sampled readout shows active mode, selected cells, completed depth, and complete/truncated status. This is an experimental visual-review control, not a production renderer cutover; the component is gated by both Vite development mode and the explicit debug flag.

The existing experiment supplies the algorithm; no duplicate rectangle planner was introduced. The overlay never invokes the expensive reference-replay report. Launch normally with `npm run dev:client -- --debug` plus the usual account arguments. For this session the debug client was launched using the worktree credentials and left open on Exact. Live CDP verification switched Exact → Rectangles → Exact with successful completed portal frames and no reported overlay errors. Screenshots are `/tmp/holtburger-live-portal-{Exact,Rectangles}.png`. These are live animated-client frames, not fixed-pose image-equivalence evidence.

Type checks, ESLint, and Knip pass for the visual control. No commit was made.

## Authorized production cutover

The user reviewed Exact versus Rectangles while looking around the live dungeon. Exact exhibited longstanding gray lines and dots at portal seams; Rectangles removed them consistently in that review. The user accepted that improvement and explicitly chose not to preserve the old seam artifact. Exact pixel equality and inclusion of its unnormalized epsilon halo are therefore not the product contract. The acceptance criteria are conservative geometric coverage, no newly omitted reference cells in the sampled scenes, valid near-plane/cell-root transitions, bounded work, and measured performance. This is not a claim of archive-wide numerical equivalence.

Rectangles are now the production default. The experimental adapter and live comparison overlay were removed. The arena clips each authored aperture in homogeneous coordinates on first use, computes its enclosing rectangle directly, and reuses that projection and finite near-volume classification for the rest of the view. Ordinary and near-ray projections have distinct cache slots. Every new view clears validity flags; no camera-dependent result survives across views. Topology preparation and fixed buffers persist until topology changes. Rectangle intersections and enclosing unions replace per-route polygon normalization, clipping, subtraction, and fragment storage. The full enlarged rectangle propagates when a union adds coverage, including newly enclosed gaps. The pure exact implementation remains an independent test/diagnostic reference, not an alternate production mode.

Storage is fixed at topology preparation. Rectangle versions are bounded by the existing queue budget; aperture scratch is bounded by the maximum reciprocal aperture plus homogeneous clip planes, independently of path length. Cache hits, writes, and rectangle operations charge actual executed work, removing the old compatibility budget and third-use cache promotion scheme. Normal traversal allocates no portal-owned frame records. The original dungeon reserves 810,319 bytes across the culler/index/arena, including 113,364 bytes for projection/near caches; this replaces the much larger exact polygon backing stores (the expanded-budget experiment reserved roughly 137 MB).

### CPU convergence and GPU depth

The seven rectangle views previously capped at CPU depth 16 were replayed with CPU depth 128 and the GPU limit unchanged. All converged: five at 17, one at 20, one at 23. Five retained the same cells; yaw 121/pitch -30 grew from 139 to 142, and yaw 46/pitch +30 from 154 to 160. None added selected GPU crossings. Evidence: `/tmp/holtburger-rect-convergence.json`.

Production now derives its CPU maximum depth from queue capacity, so the queue/operation limits bound work without an additional 16-cell cutoff. GPU propagation remains independently bounded at 16 and by selected crossing count. Intra-island CPU crossings therefore no longer consume that GPU limit. A focused long-chain test demonstrates CPU completion beyond the configured GPU limit. Existing complete-frontier rollback and GPU atlas-capacity retreat remain in force.

The fixed GPU bound is still not proven sufficient archive-wide. Raising it to the selected-crossing bound did not change either original-view image in the earlier controlled test. No GPU depth-policy redesign is included in this cutover.

### Production validation

All runs below use the debug content host, real AMD RX 7900 XT through ANGLE/Vulkan, render scale 1, and Chromium GPU VSync/frame limiting disabled. The survey includes 136 heading/pitch/local-position poses plus nine samples per accepted portal boundary, spaced 0.025 units apart. Boundary samples are admitted only when the runtime's actual cell-containment query accepts every point in its assigned source/target cell. This exercises camera-root handoff and near-plane rendering; it does not exercise live character movement authority. Unusable candidate segments are explicitly reported and excluded.

The original dungeon passed 235 views (11 boundaries / 99 transition samples), with one candidate boundary excluded by containment. Every traversal completed, maximum depth 23, and no exact-reference-selected cells were lost. At the original pose: 171 cells, 84 GPU crossings, 43 render domains, depth 13; 41,672 charged operations under the unchanged 240,181 operation budget. Projection count is 312, with 539 projection hits and 841 near-classification hits. Planning averaged 0.538 ms and instrumented frame work 1.260 ms after survey warmup. Earlier exact captures averaged about 2.65 ms planning; this is approximately an 80% reduction in planning time, not a matched live-client FPS comparison.

Falatacot Temple cell `0x665e021e`, using its geometry-validated center, passed 217 views (9 boundaries / 81 transition samples; 3 excluded candidates), maximum CPU depth 13, all complete, no reference cells lost. At the restored center: 11 cells, 6 crossings, depth 5; planning 0.038 ms. The independent wall-time interval counted 13,869 frames over 6.0018 seconds = 2,310.8 FPS. This simpler pose is additional correctness coverage, not a baseline for the original cavern.

Artifacts: `/tmp/holtburger-rect-production-{61,665e}.{json,png}`. The opt-in `HOLTBURGER_PROBE_PORTAL_TRAVERSAL=1` harness probe compares selected cells against the independent exact reference; `HOLTBURGER_PROBE_PORTAL_SURVEY=1` adds poses and containment-checked boundaries. `measuredFrameThroughput` counts actual rendered frames over a browser-clock interval immediately after resetting timing, before post-measurement reference replay or screenshots.

### Review and remaining threads

The cutover review traced arena admission/reset/rollback through culler queue and selection, selected-window access into atlas packing, and the CPU/GPU policy split through the pipeline and executor fixture. Removed obsolete polygon storage contracts, cache promotion diagnostics, duplicate executed/compatibility metrics, and the redundant delta handle. Tests now assert enclosing geometry, retained reference scopes, near-plane handling, cache invalidation, rollback, budget cutoff, and CPU/GPU limit independence. Existing independent exact geometry tests remain.

Whole-island compilation, static portal-pair rejection, and reuse of entirely unchanged plans are deferred. They require separate proofs or invalidation contracts; the measured default rectangle path should establish whether their additional complexity is justified. The remaining GPU-bound proof is deferred pending a reproducible counterexample during normal use. The user found none and agreed to close the current optimization investigation.

The third dungeon, cell `0x63460369` at its validated center, passed 244 views (12 boundaries / 108 transition samples, none excluded), maximum depth 10, all complete, no reference cells lost. Its restored view selected 13 cells and 12 crossings at depth 8, with 0.049 ms planning. Throughput was 10,226 frames / 6.0048 seconds = 1,703.0 FPS with renderer attribution enabled. These additional dungeons have simpler restored views than the original cavern; their sweeps test different geometry rather than establishing a comparable performance baseline. Reports and images: `/tmp/holtburger-rect-production-6346.{json,png}`.

The original pose was repeated with optional renderer/native profiling disabled: **4,770 frames / 6.0058 seconds = 794.23 FPS**, measured directly against browser wall time. Mean frame work was 1.192 ms. It retained 171 cells, 84 crossings, depth 13, 16 GPU propagation draws, no truncation, and no GPU retreat. Evidence: `/tmp/holtburger-rect-production-uncapped.{json,png}`. This is the isolated browser scene; the earlier 240.55 FPS live-client baseline includes different camera, viewport, entities, and client work, so a direct live-client speedup ratio is not justified. The profiled production PNG at the original pose is pixel-identical to both the earlier rectangle candidate and near-reuse candidate images (zero changed pixels).

Verification: full TypeScript suite passed **275 files / 2,139 tests**. After final admission-handle cleanup and moving the bounds-work charge before execution, the focused arena/planner/differential tests passed, and the final arena rerun passed all five cases. Svelte/TypeScript checks report no errors or warnings; ESLint, Knip, and diff whitespace checks pass. No Rust production code changed. No staging or commits.

Final GPU-capacity sweep recorded compositor metrics at every pose: **696 views across the three dungeons, zero GPU frontier retreats, zero rendered truncations, zero lost reference cells, and no browser console errors**. This includes 288 geometry-checked transition samples across 32 boundaries. Four candidate boundaries were excluded by containment. Reports: `/tmp/holtburger-rect-gpu-survey-{01f5,665e,6346}.json`. These checks establish capacity completion for the sampled views; they do not prove the fixed GPU depth sufficient for every per-pixel path.

### Pre-commit code-quality review follow-up

Addressed all three review findings: the arena and culler now expose their four stored NDC bounds directly, and atlas packing no longer reconstructs bounds from manufactured polygon vertices. Removed the fragment/vertex accessors, their validation machinery, and the obsolete vertex-read metric. Independent exact-reference tests construct polygon snapshots only in test code. The atlas planner validates its independent GPU propagation depth as a nonnegative safe integer, including an explicit zero-boundary test. Diagnostic portal centers are branded as canonical scene positions at their producer.

The focused arena, culler differential, and atlas planner suite passes 35 tests. These changes complete the reviewed representation cutover without changing the GPU depth policy.

Post-review debug/real-GPU validation: all 235 original-dungeon survey views completed with zero reference omissions, rendered truncations, GPU frontier retreats, or browser console errors. The restored original-camera screenshot is pixel-identical to the pre-review production capture. Evidence: `/tmp/portal-review-fixed.{json,png}`. Final type checks, ESLint, Knip, and diff whitespace checks pass.
