# Holtburger 3D Terrain Draw and State Reduction Plan

Status: complete. All four phases landed, were measured in the browser harness, and were reviewed
in the Explorer. Terrain per-landblock GL calls fell 4,170 -> 920 (4.5x) and the boundary-crossing
generation stall fell 6.51 ms -> 0.50 ms (13.2x), both at `terrainRadius: 8`.
Created: 2026-08-14
Related: `docs/plans/holtburger-3d-shader-composited-terrain-plan.md`,
`docs/plans/holtburger-3d-terrain-loading-pipeline-plan.md`

> Superseded for distant terrain by Phase 4 of
> `docs/plans/holtburger-3d-worker-terrain-vertex-color-plan.md`. The whole-landblock solid-color
> mechanism and its live vocabulary were deleted in favor of sampler-free per-vertex terrain
> colors. Historical measurements and names below are retained as recorded evidence.

## Goal

Three changes, in order:

1. Hoist the region-constant terrain texture binds out of the per-landblock draw loop.
2. Delete the terrain mesh LOD mechanism.
3. Render distant landblocks as a flat color.

Terrain keeps being drawn landblock by landblock. The cost being reduced is per-landblock device
state, not draw count.

## Starting State

Static counts read from the code, not profiled. The baseline phase confirms or corrects them.

**Per-landblock device state dominates the draw path.** `#drawTerrain`
(`webgl2-renderer.ts:2253-2280`) issues one `drawElements` per landblock. For one unlit landblock:

| source                                                                                              | calls |
| --------------------------------------------------------------------------------------------------- | ----- |
| `#bindTerrainResources` — 6 textures x (`activeTexture`, `bindTexture`, `bindSampler`, `uniform1i`)   | 24    |
| `activeTexture` reset                                                                                | 1     |
| `bindWebGL2StaticLights` (early-returns at count 0)                                                  | 1     |
| `#uploadTerrainLightMask` (skipped when unlit)                                                       | 0     |
| `uniformMatrix4fv`, `uniform3f`, `bindVertexArray`, `drawElements`                                    | 4     |
| **total**                                                                                            | **~30** |

The benchmark configuration throughout is the `terrainRadius: 8` default (17x17, 289 resident
landblocks). Phase 0 measured **4,170 calls per frame** across the 139 landblocks that survive
frustum culling at the benchmark pose — 30.0 per landblock, matching this table exactly.

**Five of the six texture binds are redundant.** `colors`, `blendMasks`, `roadMasks`, `detail`, and
`composition` are keyed on `activeRegionKey` (`terrain/types.ts:203`) and are identical for every
landblock. Only `surfaceField` is per-landblock. `TextureSamplerCatalog.bind`
(`webgl2-texture-sampler-catalog.ts:121`) has no redundancy cache and reissues `bindSampler` every
time.

**Mesh LOD generates 36x the geometry it draws.** `TERRAIN_MESH_STRIDES = [1, 2, 4, 8]`
(`terrain/types.ts:118`) crossed with nine transition directions produces 36 variants per landblock
in `generateTerrain` (`terrain-generator.ts:81`); `selectTerrainMeshStride` draws one.

| per landblock  | generated | drawn | ratio |
| -------------- | --------- | ----- | ----- |
| variants       | 36        | 1     | 36x   |
| vertices       | 1,071     | 81    | 13.2x |
| indices        | 4,590     | 384   | 12.0x |
| surface fields | 4         | 1     | 4x    |

Geometry is trivially small either way: `TERRAIN_GRID_CELLS = 8` (`landblocks.ts:7`) means 128
triangles per landblock, about 37k triangles across a full 17x17 window.

**That cost is paid on streaming, not once at load.** `removeSource` (`terrain-system.ts:215`) drops
the installation when a landblock leaves interest and there is no result cache, so re-entry
regenerates. `InlineTerrainGenerator` is synchronous on the runtime thread by choice
(`terrain-generator.ts:37-44`). One boundary crossing installs a full column — 17 landblocks at the
default radius, i.e. 612 variant generations, synchronously.

**Mesh LOD is presentation-only.** `sampleTerrainSurface` (`terrain-surface.ts:33`) reads
`source.heights` directly, so placement and physics never consult a generated variant. Outside the
generator, `terrain/types.ts`, and `terrain-system.ts`, nothing consumes `TerrainMeshStride`.

**Fog is linear.** `fog = clamp((distance - near) / (far - near), 0, 1)` (`webgl2-fog.ts:9`), and
`resolveTerrainCoverageFog` (`environment/terrain-fog.ts:40`) pins `far` to
`(terrainRadius + 0.5) * OUTDOOR_LANDBLOCK_WORLD_SIZE`.

**"LoD" names two unrelated things.** `LoDConfig.terrainRadius` and the Explorer's terrain "LoD"
slider (`explorer/explorer-lod.ts`) select *residency radius*, not detail.

## Out of Scope

- Instanced or merged terrain geometry. Landblock geometry is installed and released independently
  on the streaming path; sharing buffers across landblocks adds suballocation bookkeeping there to
  save a `bindVertexArray`, which is the cheapest state change in the loop. Not worth it.
- Atlasing the surface fields. Considered as a way to remove the last per-landblock texture bind,
  but it needs its own install/evict residency story on the same streaming path, for one bind.
- Moving terrain generation to a worker. Phase 2 shrinks the synchronous stall by roughly 12x;
  revisit only if it still hurts afterwards.
- Changing the residency radius default, fog range derivation, or scene-interest policy.
- Any appearance change beyond the two named below.

Two appearance changes are accepted and deliberate: Phase 2 removes the stride transition
adjustment, which alters distant heights, and Phase 3 renders distant landblocks flat. Anything else
found in a capture is a defect, not a tradeoff.

## Phase 0: Baseline

Deliberately small. Enough evidence to confirm the hoist works and to size the streaming win.

- Add an opt-in GL call counter to the browser harness, attributed to the terrain pass. No hot-path
  cost when disabled.
- Report `generateTerrain` wall time and allocated bytes per landblock installation, same opt-in.
- Capture a static frame and one boundary crossing at `terrainRadius: 8`.

Acceptance: terrain-pass call count and crossing stall recorded; counters verified inert when
disabled.

### Result: complete

**Call counting.** Added `FrameSelectionMetrics.terrainPerLandblockGlCalls`, incremented inside the
terrain-path methods themselves rather than at their call sites, so the tally cannot drift from the
calls it describes. `#bindTexture2D` and `#bindTextureArray` are terrain-exclusive and count
themselves; `bindWebGL2StaticLights` now returns its call count so the caller need not restate its
internals. Selection metrics already flow to harness output, so no harness plumbing was needed.

*Concession:* the counter is unconditional, matching the neighbouring `staticLightBinds` and
`terrainLightMaskUploads` rather than the opt-in profiling contract. Three integer adds per landblock
is not a hot-path cost, and gating them would have meant threading a flag through five call sites to
save nothing measurable. The plan's "no hot-path cost when disabled" wording was written before that
precedent was checked.

**Baseline, `terrainRadius: 8`, landblock `0xda55ffff`, building radius 0, `--gpu`:**

| metric | value |
| ------ | ----- |
| `terrainPerLandblockGlCalls` | **4,170** |
| terrain landblocks drawn | 139 |
| calls per landblock | **30.0** |

The static read of ~30 calls per landblock was exact. **The 8,670-per-frame estimate was not**: it
assumed all 289 resident landblocks are drawn, but the pass iterates *visible* terrain, and frustum
culling leaves 139 at this pose. Per-landblock cost is what the estimate got right and what every
phase targets; the frame total is roughly half what was projected.

**Generation cost** (`scripts/measure-terrain-generation.ts`, temporary, delete after Phase 2):

| metric | value |
| ------ | ----- |
| per landblock | **0.383 ms** |
| 17-landblock crossing column | **6.5 ms** |
| bytes per landblock | 43,792 |
| variants / vertices / indices | 36 / 1,071 / 4,590 |

6.5 ms synchronous on the runtime thread per boundary crossing is a hard hitch well past a 60 fps
budget, which sizes Phase 2 better than the estimate did.

**Harness change:** added `--terrain-radius`, because the harness previously derived
`terrainRadius` from `--building-radius`, and a radius-8 terrain capture would otherwise load a
radius-8 building neighborhood irrelevant to the terrain pass.

## Phase 1: Hoist Region-Constant Binds

Independent of the other phases and the largest win per line changed.

`#bindTerrainResources` (`webgl2-renderer.ts:2285`) binds all six textures per landblock. Bind
`composition`, `colors`, `blendMasks`, `roadMasks`, and `detail` once at pass setup alongside
`#beginTerrainLightMasks`; leave only `surfaceField` in the loop.

This is unconditional, not an assumption: `activeRegionKey` is derived from
`activeRegion.provenance.sourceRecordId@version` alone and takes no landblock input
(`active-region-terrain-resolver.ts:119`), and every landblock resolves against a single
`ActiveRegionSource` held `readonly` for the content source's lifetime
(`http-landblock-content-source.ts:60-64`, `tauri-landblock-source-batch.ts:12-19`). No per-landblock
region selection exists.

- Hoist the five binds to pass setup.
- Assert at pass setup that every submitted landblock carries the pass's `activeRegionKey`, so a
  future multi-region content source fails loudly instead of rendering a neighbour's palette.
- Consider a redundancy cache in `TextureSamplerCatalog.bind` only if a measured caller still
  rebinds after the hoist.

Acceptance: calls drop by close to 5 binds x 4 calls x 289 landblocks; screenshots pixel-identical to
baseline; a mixed-region submission fails a test.

### Result: complete

`#bindTerrainResources` split into `#beginTerrainPassResources` (the five region-constant textures,
bound once per pass beside `#beginTerrainLightMasks`) and `#bindTerrainSurfaceField` (the one
genuinely per-landblock texture). Bound per pass rather than once at program build, because other
passes own those texture units in between.

| metric | baseline | after | change |
| ------ | -------- | ----- | ------ |
| `terrainPerLandblockGlCalls` | 4,170 | **1,390** | **-2,780 (3.0x)** |
| calls per landblock | 30 | **10** | -20 |
| terrain landblocks drawn | 139 | 139 | — |

Exactly the predicted 5 binds x 4 calls x 139 drawn landblocks.

**Screenshot evidence.** Not byte-identical, so the noise floor was measured rather than assumed:

| comparison | differing pixels | max channel delta |
| ---------- | ---------------- | ----------------- |
| phase 1 vs phase 1 (*same build*, two runs) | 314 | 40 |
| baseline vs phase 1 | 363 | 38 |
| baseline vs phase 1 (second run) | 365 | 40 |

Two runs of identical code differ by as much as baseline-vs-change does, so the hoist is
pixel-equivalent within the harness's run-to-run noise. That noise is real and previously
unquantified — roughly 300-400 pixels of 810,240 at up to delta 40, scattered through the terrain
region. AGENTS.md notes captures "are still not byte-identical for reasons that were never
isolated"; this sizes it but does not explain it.

**Region assertion.** `assertSharedTerrainRegion` lives in `terrain-program-input.ts` beside the
type it guards, rather than as a private renderer function, so it is directly unit-testable without
a GL context. Six cases cover the composition table, landscape detail, and all three texture arrays.

*Debt found and fixed in passing:* `terrainLightMaskUploads` existed on the renderer's internal
`MutableFrameSelectionMetrics` but not on the public `FrameSelectionMetrics`. The snapshot builds
its result with an object spread, which skips excess-property checking, so the field reached harness
JSON untyped. Added to the public interface.

*Not done:* the `TextureSamplerCatalog.bind` redundancy cache. The hoist removed five of the six
per-landblock sampler binds, and the plan conditioned the cache on a measured caller still rebinding
afterwards. One remains, for the surface field, and it is not worth a cache.

## Phase 2: Delete Mesh LOD

Remove `TerrainMeshStride`, `TERRAIN_MESH_STRIDES`, `TerrainTransitionDirection`,
`selectTerrainMeshStride`, and `selectTerrainTransitionDirection`. `generateTerrain` produces one
mesh and one surface field per landblock at the authored 8x8 resolution.

This also deletes `generateVariantHeights`' transition machinery — `averageRow`, `averageColumn`,
`applyCardinalHalfResolutionClamps` — which exists only to hide cracks between mismatched strides.
With a uniform stride there are no cracks. That code is a careful retail port carrying its own
correction to ACE and ACViewer; the deletion removes a mechanism and does not imply the port was
wrong.

Guarantees removed, and their replacements:

| guarantee                                   | replacement                                             |
| ------------------------------------------- | ------------------------------------------------------- |
| Reduced triangle count at distance          | None needed; 37k triangles is not a constraint.         |
| Crack-free seams between adjacent landblocks| Uniform stride shares authored edge heights exactly.    |
| Retail-matching distant silhouette          | Intentionally dropped. This is the point of the phase.  |
| Stride-selected surface field per draw      | The single authored-resolution field.                   |

- Leave a `RETAIL DIVERGENCE` marker in `terrain-generator.ts` noting we drop retail's
  `CLandBlockStruct::TransAdjust` (`acclient.c:339719`) because LOD was a 1999 performance
  technique. One comment; no census.
- Collapse `generateTerrain` to a single variant; simplify `terrain-system.ts` selection
  (`terrain-system.ts:435-447`, `529`, `544`).
- Size output buffers up front and write directly into `Float32Array`, dropping the `push(...)`
  accumulation into `number[]`.
- Replace `Math.max(...indices)` in `createIndices` (`terrain-generator.ts:438`); index width is
  derivable from the vertex count without scanning.
- Delete the variant-matrix tests rather than migrating them; add single-mesh invariant tests.
- Sweep the vocabulary. This includes renaming `LoDConfig.terrainRadius`, `explorer/explorer-lod.ts`
  and its exports, `EXPLORER_TUNING.residency`, and the Explorer panel label so residency stops
  reading as detail — clean cutover, no aliases. It also includes the light-grid comment at
  `webgl2-terrain-program.ts:111-113`, which justifies the light grid's independence from the surface
  field by that field's resolution dropping with the stride. The grids stay separate; the reason must
  be restated rather than left stale.

Acceptance: crossing stall down roughly an order of magnitude; generated bytes down roughly 13x;
`grep -rn "stride\|transitionDirection" apps/holtburger-3d/src` returns nothing terrain-related; no
symbol or label uses "LoD" for residency. Capture screenshots before Phase 3 lands so the two
appearance changes stay separately attributable.

### Result: complete

| metric | before | after | change |
| ------ | ------ | ----- | ------ |
| generation per landblock | 0.383 ms | **0.0291 ms** | **13.2x** |
| 17-landblock crossing column | 6.51 ms | **0.495 ms** | **13.2x** |
| bytes per landblock | 43,792 | **3,616** | 12.1x |
| vertices / indices | 1,071 / 4,590 | 81 / 384 | 13.2x / 12.0x |

A boundary crossing no longer stalls the runtime thread for two thirds of a 60 fps frame budget.

**The appearance change is larger than this plan predicted, and in a different way.** It was
described throughout as a silhouette change from dropping the transition adjustment. The dominant
visible effect is instead **distant terrain composition resolution**: `TerrainPcodeField` was
generated per stride, so a stride-8 landblock composited from a *1x1* pcode grid and stride-4 from
2x2. Distant terrain was therefore not merely lower-poly, it was texturally smeared — rivers became
blobs and roads disappeared entirely. At uniform resolution every landblock composites from the
authored 8x8 grid, so distant rivers, roads, and terrain-type boundaries are now crisp.

The `surface fields 4 -> 1` row in Starting State was the evidence for this and its significance was
missed. Direction is the intended one: distant terrain now matches the authored data rather than a
1999 approximation of it. Reviewed against captures and healthy — no cracks, holes, or seams.

Screenshot diff versus Phase 1: 456,682 pixels of 810,240 at max delta 104, three orders of
magnitude past the ~350-pixel noise floor Phase 1 established. Captured before Phase 3 so the two
appearance changes stay separately attributable.

**Subtractions beyond the checklist.** Uniform geometry made several mechanisms dead rather than
merely simpler, and they were removed rather than left vestigial:

- `TerrainSystem.updateSceneBoundsForAnchor`, `#boundsAnchorLandblockId`, and the anchor-change
  resync in `GameRuntime` existed only because bounds varied per selected variant. One mesh means
  bounds are fixed at realization.
- `TerrainVariant`, `TerrainVariantDrawRange`, and `#selectVariant` had nothing left to select.
- `TerrainDrawUnit.indexStart` / `indexCount` were always the whole mesh, so `#drawTerrainGeometry`
  now draws `binding.indexCount` from zero and `validateDrawRange` has no terrain caller.
- `anchorLandblockId` became dead in `getDrawUnit`, `resolveTerrainDrawUnit`, and
  `getRenderContributionDescriptor`, and was removed from all three.
- `createTerrainSurfaceTextureKey` lost its stride component, so the key is now
  `terrain-surface:${landblockId}`.

**Rename.** `LoDConfig` -> `SceneInterestRadii`; `explorer-lod.ts` -> `explorer-residency-radius.ts`
with its exports renamed to match; `EXPLORER_TUNING.residency`; the `lod:` field
on scene-interest requests -> `radii:`; the Explorer panel label "Outdoor LoD" -> "Outdoor
residency", and its DOM/CSS ids with it. Clean cutover, no aliases. `grep -rni "\blod\b"` over
`src` now returns only the deliberate `RETAIL DIVERGENCE` marker.

**Shader comment.** The light-grid comment at `webgl2-terrain-program.ts` justified the light grid's
independence from the surface field by that field's resolution dropping with the stride. Both grids
are now 8x8, so the stated reason is gone but the separation is still right — they answer different
questions. Restated rather than deleted, so nobody later derives the lamp bucket from the
composition grid.

**Tests.** The variant-matrix tests in `terrain-generator.test.ts` and the stride/transition-ring
tests in `types.test.ts` were deleted rather than migrated; they asserted the mechanism being
removed. `terrain-generator.test.ts` was rewritten around single-mesh invariants, including one that
the plan's guarantee table promised but nothing previously checked: **adjacent landblocks sharing an
edge produce identical vertex heights**, which is what replaces crack-free stride seams.

## Phase 3: Solid Distant Landblocks

Landblocks past **50% fog coverage** render as one flat color and skip their light state. Accepted
fidelity concession: distant terrain does not need to be correct.

**The cutoff is a landblock ring, not a world distance.** Fog supplies the derivation; landblocks
supply the unit. Fog is linear, so `fog == 0.5` at `(near + far) / 2` world units, and the ring is
that converted to whole landblocks:

```
solidCutoffLandblocks = ceil( ((fog.near + fog.far) / 2) / OUTDOOR_LANDBLOCK_WORLD_SIZE )
```

computed once wherever fog coverage is already resolved, from the coverage-adjusted
`ResolvedDistanceFog` (`far = (terrainRadius + 0.5) * OUTDOOR_LANDBLOCK_WORLD_SIZE`,
`near = far * authoredNear/authoredFar`). Because `far` tracks the residency radius, the ring scales
with the window automatically. When fog is disabled nothing goes solid.

Per landblock the test is then
`landblockChebyshevDistance(landblockId, anchorLandblockId) >= solidCutoffLandblocks` — the same
predicate `selectTerrainMeshStride` used before Phase 2 removed its caller.

Landblock units rather than world distance for three reasons. They are the unit everything else in
scene interest already uses. The solid set stays fixed relative to the anchor, so a landblock near
the ring cannot flicker solid as the camera moves *within* its own landblock — the set changes only
on a boundary crossing, where residency already churns. And the test needs no AABB, no
camera-to-box distance, and no landblock-local to anchor-relative conversion at selection time.

Fog saturation is *not* a usable substitute cutoff: linear fog reaches 1.0 only at exactly `far`, so
a saturation test selects a razor-thin shell at the residency boundary and nothing else.

The flat color is the landblock's average composited terrain color, computed once at generation from
its pcode field and the region composition table, and delivered as a `uniform3f` — per-landblock
drawing means no instance attributes are needed.

- Compute and retain the average color per terrain source.
- Partition the draw loop by the cutoff distance; draw textured landblocks, switch program once,
  draw solid ones. Two program binds per pass, not per landblock.
- The solid path skips the `surfaceField` bind and sampler bind, the light count uniform, and the
  mask `texSubImage2D` — that upload is the most expensive per-landblock operation remaining.

Acceptance: peripheral landblocks issue no texture binds and no uploads; calls drop by roughly the
solid share of the window.

Ship 50% and tune later. Keep the threshold a single named constant so adjusting it is a one-line
change. If the ring turns out to read badly, raise it first; blending across a band instead of
switching at a line is available but is not built unless raising it fails.

### Result: complete

`SHARED_FRONTEND_TUNING.rendering.solidTerrainFogCoverage` is the one constant; `solidTerrainCutoffLandblocks`
in `environment/terrain-fog.ts` converts it and the frame's fog into an integer ring, and
`landblockChebyshevDistance` (promoted to `landblocks.ts`) tests each landblock against it.

| metric | Phase 2 | Phase 3 | change |
| ------ | ------- | ------- | ------ |
| terrain GL calls | 1,390 | **920** | -470 |
| composited landblocks | 139 | 45 | at 10 calls each |
| flat landblocks | 0 | **94** | at 5 calls each |
| cutoff ring | — | 5 | derived, not configured |

45 x 10 + 94 x 5 = 920 exactly. Cumulative from baseline: **4,170 -> 920, a 4.5x reduction.**

**These call totals are no longer measurable from the shipped build** -- see "Measurement
scaffolding removed" below. They were captured with a temporary counter and are recorded here as
the evidence for the phase, not as something a future run can reproduce without reinstating it.

**The flat colour needs no CPU texture access.** `TerrainColor` arrays carry a complete mip chain
(`texturePurposePolicy`), so their 1x1 level is the box-filtered average of each terrain texture. The
fragment program samples the dominant terrain type's colour at that level, which is the colour the
composited surface would average to. Generation therefore only has to name a terrain code, not
resolve a colour: `dominantTerrainCode` is a 32-bucket tally over the pcode field's corners.

**Two partitions, not one interleaved loop.** Submission order is not distance-sorted, so a single
loop would toggle `uSolidTerrain` once per run of like landblocks. Drawing composited landblocks
then flat ones sets it exactly twice per pass.

**Visual evidence.** Verified against a scene with real fog, then A/B'd against the same scene with
the cutoff disabled. Sky is split out because it is animated and noisy:

| comparison | sky pixels | ground pixels | ground max delta |
| ---------- | ---------- | ------------- | ---------------- |
| same build, two runs | 146,940 | 21,289 | 28 |
| cutoff off vs on | 234,893 | **89,466** | 39 |

Sky matches its own noise floor, as it must — terrain cannot draw above the horizon. Ground is 4.2x
the noise floor at a maximum channel delta of 39/255, confined to the mid-to-far band where river
and road detail lives. No hard ring is visible in the rendered frame; the flat landblocks lose
detail rather than gaining an edge. Shipping 50% unchanged.

**Behavioural caveat worth knowing: the optimization is weather-dependent.** `distanceFog` resolves
to null when the region's sky keyframes author `worldFog === 0`, and `solidTerrainCutoffLandblocks`
deliberately returns `Infinity` then, so nothing goes flat without fog to hide it. This region
authors non-zero fog in all 232 sky times across all 20 day groups, so the path engages in practice
here — but a region or weather state without fog gets none of Phase 3's saving and falls back to
Phase 2's 1,390 calls. That is the correct trade: the alternative is a visible flat ring in clear
air.

**Harness gotcha, cost two full capture runs.** `BrowserHarnessApp` only resolves a scene
environment when `--time-of-day` is passed. Without it there is no environment, therefore no fog,
therefore no sky and no flat terrain — and the frame still renders plausibly, against the fallback
clear colour, so nothing announces the omission. Any capture that depends on fog, sky, or lighting
needs `--time-of-day`.

### Measurement scaffolding removed

`terrainPerLandblockGlCalls` was deleted after the phases landed, and `bindWebGL2StaticLights` was
reverted to returning `void`.

It was a raw GL-call tally assembled from five hand-maintained constants (`+1`, `+3`, `+4`, `+5`)
scattered across the terrain draw path, which would have drifted silently the first time anyone
edited a binder. Worse, feeding it was the *only* reason `bindWebGL2StaticLights` returned a count --
diagnostics shaping a production signature. It earned its place while the plan needed before/after
numbers and stopped earning it the moment those were recorded.

Two counters stayed, because they are a different kind of thing and both have precedent beside them
in `FrameSelectionMetrics`:

- `solidTerrainDraws` counts a semantic event, exactly like the neighbouring `terrainLightMaskUploads`
  and `staticLightBinds`. It is the only visibility into how much of a frame went flat, which varies
  with weather.
- `solidTerrainCutoffLandblocks` is a resolved policy readout, the same shape as the existing
  `ambientOcclusion.effectiveDistanceFade`. The ring is derived from fog rather than configured, so
  without it there is no way to see where it landed.

### Quality pass

Applied after the phases landed and before commit, verified against an unchanged render (ground
diff 23,348 px against a 21,289 px noise floor):

- `solidTerrainCutoffLandblocks` returns `number | null` rather than `Infinity`, and the metric is
  typed the same. The sentinel pair (`Infinity` in the predicate, `-1` in the metric) forced a
  `Number.isFinite` conversion at the call site and would not have survived the JSON boundary that
  carries renderer diagnostics. Callers now handle "never" explicitly.
- `#drawTerrainPartition` sets `uSolidTerrain` unconditionally instead of tracking a first-draw
  flag, which removed the flag and its unclear name.
- Replaced `distance >= solidCutoff !== solid`, a precedence puzzle, with a named `isSolid`.
- `MAXIMUM_TERRAIN_CODE` promoted into `terrain-sample.ts` beside the bit layout it describes,
  replacing hardcoded `32` and `& 31` in the dominant-code tally.
- `validateTerrainGenerationResult` now range-checks `dominantTerrainCode`. It crosses the
  replaceable `TerrainGenerator` port and lands in the shader as a composition-table column, so a
  bad value would otherwise surface as an out-of-range texel fetch rather than a contract violation.
- Fixed a dangling `#assertPassRegion` reference left by renaming that function.
- `validateLoDConfigOrThrow` -> `validateSceneInterestRadiiOrThrow`. The Phase 2 sweep missed it
  because the verification grep used `\blod\b`, which cannot match a substring inside a longer
  identifier. A substring-inclusive scan now returns only `explode`/`implode` and the deliberate
  `RETAIL DIVERGENCE` marker.
- Prettier drift from scripted edits fixed across 13 files.

### The cutoff ring responds to its constant

Recorded because the derivation is indirect enough to look like a defect. Captures taken at
`solidTerrainFogCoverage: 0.5` reported ring 5 and 94 flat landblocks; captures at `0.33` reported
ring 4 and 111. That is the knob working: a smaller coverage fraction puts the ring nearer, so more
of the window renders flat.

The ring is not configured directly, so reading it back from `solidTerrainCutoffLandblocks` is the
only way to see where a given constant landed. Both figures above are samples of one pose in one
region at one time of day; neither is a property of the code.

## Benchmarking

All captures use `terrainRadius: 8` — 17x17, 289 landblocks — with `--gpu`. Record radius, landblock,
content set, hardware, and harness flags alongside every number. Do not quote a figure from this or
any other doc without its configuration.
