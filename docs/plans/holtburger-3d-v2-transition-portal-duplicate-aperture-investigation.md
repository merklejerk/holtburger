# Holtburger 3D V2 Transition Portal Duplicate Aperture Investigation

Status: in progress  
Date: 2026-06-18

## Summary

The V2 transition portal overlay investigation found exact duplicate outside-transition aperture polygons in at least landblock `0xf418ffff`. These are not just visually similar nearby polygons or a debug overlay projection artifact. The same transformed aperture point set can be emitted by two different env cells, with different portal flags, and the V2 overlay/compositor currently treats those as independent transition aperture ranges.

The clearest reproduced case is the user-reported arch aperture shared by env cells `0xf4180103` and `0xf418010b`. It appears green in the outdoor-to-indoor debug mode, red in the indoor-to-outdoor debug mode, and yellow in the combined mode because both directional overlays occupy the same screen-space and world-space polygon.

This invalidates an important working assumption in the V2 portal compositor: a transition aperture range is not necessarily a unique physical opening.

## Scope

In scope:

- Record the user-visible symptoms and screenshots that triggered the investigation.
- Record the debug methods used to isolate direction overlays and inspect host env-cell data.
- Record the concrete duplicate aperture evidence found in `0xf418ffff`.
- Identify which current V2 compositor assumptions are now suspect.
- Capture next questions before changing the compositor model.

Out of scope:

- Implementing the dedupe or compositor fix.
- Deciding final portal recursion/frontier semantics.
- Reworking debug overlay visuals beyond the direction selector already used during investigation.

## Trigger

The user observed transition portal debug overlays that appeared yellow in the combined overlay mode. The initial theory was that this might be an ordinary blend result from overlaying a red aperture against the scene, or a nearby overlapping polygon. The user then isolated the overlay with the direction selector:

- `Outdoor to indoor` showed a filled green aperture.
- `Indoor to outdoor` showed the same filled red aperture.
- `Both directions` showed yellow over the same aperture.

The user reported no edge drift or parallax when rotating the camera, which strongly suggested the same polygon rather than adjacent or projected geometry.

The screenshot diagnostics identified the relevant area as landblock `0xf418ffff`, with camera residency near env cells `0xf4180103` and `0xf418010b`.

## Current V2 Model Under Investigation

The V2 transition aperture baker creates one landblock-level `TransitionApertureBatch` from outside-transition portals in committed env-cell records.

Relevant files:

- `apps/holtburger-3d/src/v2/static/env-cells/bake/transition-aperture-batches.ts`
- `apps/holtburger-3d/src/v2/static/contracts.ts`
- `apps/holtburger-3d/src/v2/runtime/client-runtime.ts`
- `apps/holtburger-3d/src/v2/renderer/transition-composite-work-plan.ts`
- `apps/holtburger-3d/src/v2/renderer/webgl2/webgl2-renderer.ts`

Important current behaviors:

- Only portals where `portal.isOutsideTransition` is true are included in transition aperture batches.
- Aperture points are transformed from env-cell local space into landblock render-local space.
- The baker triangulates each aperture and stores a range per outside-transition portal.
- The stored batch front face is modeled as `indoor-visible`.
- The debug overlay renders:
  - red for indoor-to-outdoor using stored winding,
  - green for outdoor-to-indoor using reversed winding.
- The compositor currently draws aperture batches by batch id, not by individual range identity.

## Methods

### Direction-Isolated Debug Overlay

A temporary/debug-facing overlay selector was added to isolate transition aperture overlay modes:

- `Both directions`
- `Outdoor to indoor`
- `Indoor to outdoor`

This allowed visual confirmation that the same apparent aperture existed in both synthetic directions rather than only in the combined overlay.

### Env Cell Asset Inspection

The debug harness env-cell inspector was extended to print portal and aperture facts:

- portal id
- source index
- flags
- polygon id
- linked cell/portal
- resolved target env cell id
- outside-transition classification
- aperture point count
- aperture plane
- local aperture point coordinates

Commands used:

```bash
cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell f4180103
cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell f418010b
```

### Landblock Duplicate Aperture Scan

The landblock env-cell BVH inspector was extended with a `--portal-duplicates` mode.

The duplicate scan:

1. Walks all outside-transition apertures in the landblock env-cell asset.
2. Transforms aperture points into landblock render-local coordinates using the same placement transform model as the transition aperture baker.
3. Quantizes transformed points to `0.001`.
4. Sorts each aperture point set into a canonical key.
5. Groups apertures with identical canonical transformed point sets.

Command used:

```bash
cargo run -p holtburger-debug-harness --bin inspect_landblock_env_cell_bvh -- --landblock f418ffff --limit 0 --portal-duplicates
```

## Evidence

### Env Cell `0xf4180103`

Inspection summary:

```text
environment=0x0d00049e
cellStructure=0x00000000
renderTriangles=20
surfaces=7
portals=5
apertures=5
```

Relevant portals:

```text
portal/00 flags=0x0005 polygon=20 otherCell=0xffff outsideTransition=true
portal/01 flags=0x0005 polygon=21 otherCell=0xffff outsideTransition=true
portal/02 flags=0x0005 polygon=23 otherCell=0xffff outsideTransition=true
portal/03 flags=0x0003 polygon=24 otherCell=0x0105 target=0xf4180105 outsideTransition=false
portal/04 flags=0x0005 polygon=22 otherCell=0xffff outsideTransition=true
```

The screenshot-relevant aperture is `portal/01`, a 7-point arch on local plane `n=(0,0,-1), c=12`.

### Env Cell `0xf418010b`

Inspection summary:

```text
environment=0x0d00049f
cellStructure=0x00000005
portals=2
apertures=2
```

Relevant portals:

```text
portal/00 flags=0x0007 polygon=28 otherCell=0xffff outsideTransition=true
portal/01 flags=0x0001 polygon=29 otherCell=0x010e target=0xf418010e outsideTransition=false
```

The screenshot-relevant aperture is `portal/00`, also a 7-point arch, on local plane `n=(0,0,-1), c=-12`.

### Whole-Landblock Duplicate Scan

Duplicate scan summary for `0xf418ffff`:

```text
landblock=0xf418ffff
envCells=24
bvhItems=24
bvhNodes=15
overlappingPairs=30
transitionPortalDuplicateSummary transitionApertures=35 duplicateGroups=11
```

The screenshot-correlated duplicate group:

```text
duplicateTransitionPortalGroup members=2
  envCell=0xf4180103 portal=interior-cell/f4180103/portal/01 flags=0x0005 polygon=21 points=7
  envCell=0xf418010b portal=interior-cell/f418010b/portal/00 flags=0x0007 polygon=28 points=7
    p0=(40.687,187.200,-48.000)
    p1=(38.954,189.500,-48.000)
    p2=(36.000,190.700,-48.000)
    p3=(33.129,189.500,-48.000)
    p4=(31.498,187.200,-48.000)
    p5=(31.498,181.895,-48.000)
    p6=(40.687,181.895,-48.000)
```

Other duplicate groups were also found in the same landblock. Examples include:

```text
0xf4180107 portal/01 flags=0x0007 + 0xf4180112 portal/01 flags=0x0005
0xf4180104 portal/00 flags=0x0005 + 0xf4180106 portal/02 flags=0x0007
0xf4180101 portal/01 flags=0x0007 + 0xf4180104 portal/02 flags=0x0005
0xf4180109 portal/04 flags=0x0007 + 0xf4180114 portal/01 flags=0x0005
0xf4180102 portal/00 flags=0x0007 + 0xf4180103 portal/04 flags=0x0005
```

This makes the duplicate aperture behavior a real data pattern in this landblock, not a one-off visual oddity.

## Findings

1. Exact duplicate outside-transition aperture polygons exist across different env cells.

   The `0xf4180103` and `0xf418010b` arch aperture points become identical after transformation into landblock render-local coordinates.

2. Duplicate apertures can carry different portal flags.

   The confirmed pair uses `0x0005` and `0x0007`. The current baker's visible-side decode depends on `flags & 0x2`, so these records can drive different winding/visibility behavior even when the physical aperture polygon is identical.

3. The yellow debug overlay is explained by duplicate directional overdraw.

   Isolating the overlay showed the same aperture in green and red. Combined mode blends both, producing yellow.

4. The current overlay modes are direction visualizations, not proof of two separately meaningful physical portal openings.

   Red and green are produced by rendering the stored winding and reversed winding of each included transition aperture range. When duplicate records exist for the same physical polygon, the overlay can make the same opening appear to be both directions.

5. The compositor's batch-level draw model is too coarse for this case.

   If the renderer only knows "draw this transition aperture batch", it cannot select, dedupe, or suppress specific duplicate aperture ranges.

## Invalidated Assumptions

The investigation invalidates these assumptions:

- A transition aperture range maps one-to-one to a unique physical opening.
- Drawing every transition aperture range in a landblock batch is harmless.
- Transition direction can be inferred only from recursion depth parity.
- A combined red/green overlay only indicates two nearby or visually overlapping openings.
- Env-cell outside-transition aperture records are already uniquely normalized by the asset pipeline.

## Impact on Portal Compositing

The duplicate aperture behavior matters because portal compositing is sensitive to both mask identity and recursion frontier.

Potential consequences of the current model:

- Duplicate aperture ranges may draw the same mask area multiple times in a pass.
- Opposing or differently flagged duplicate records may confuse direction selection.
- Batch-level drawing prevents the compositor from choosing a single canonical physical aperture.
- Nested transition portals may be capped, overwritten, or incorrectly advanced if the same physical aperture participates in multiple env-cell records.
- Debug overlays can imply directional state that is really an artifact of duplicated records plus synthetic reversed overlay drawing.

## Likely Architectural Implications

The renderer probably needs a range-level transition aperture model, even if the GPU resource remains one landblock-level VAO.

A cleaner model would separate:

- GPU storage: one batched VAO/index buffer for all transition aperture triangles in a landblock.
- Logical aperture identity: a per-range or per-physical-opening id that the planner can select.
- Physical aperture grouping: duplicate transformed polygons grouped into one physical aperture where appropriate.
- Source metadata: the env-cell portal records that contributed to that physical aperture.

This does not necessarily require many draw calls. It does require the compositor to stop treating the whole aperture batch as the smallest unit of portal logic.

## Open Questions

1. Should duplicate aperture canonicalization happen in the baker, the static coordinator, or the portal work planner?

2. When two env-cell portal records produce the exact same physical aperture, should the runtime keep one canonical physical aperture with multiple source portal records attached?

3. Which source record should determine winding/front-face semantics for a canonical physical aperture, or should winding be derived from the canonical physical plane and current scene domain instead?

4. How does V1 classify and render this exact `0xf4180103` / `0xf418010b` case?

5. Does V1 build explicit transition work items/frontiers that naturally avoid drawing duplicate physical apertures?

6. Are `0x0005` and `0x0007` flags representing opposite visible sides, a transition subtype, or a paired data convention in AC env-cell records?

7. Can duplicate physical apertures occur across landblocks, or only between env cells within the same landblock env-cell asset?

## Recommended Next Investigation

Before changing production compositor behavior, inspect V1's portal rendering path for this exact case.

Targets:

- V1 transition portal candidate/work-item generation.
- How V1 maps env-cell portals to portal masks.
- Whether V1 dedupes physical apertures.
- Whether V1 selects portal masks by current camera residency/frontier rather than by all transition records.
- Whether V1 treats the `0x0005` / `0x0007` pair as one physical opening with two logical sides.

Recommended V2 follow-up:

- Add a non-durable debug inspection path for selected transition aperture range id, env cell id, portal id, flags, and canonical physical aperture key.
- Consider adding baker-level duplicate grouping for transformed outside-transition apertures.
- Keep duplicate grouping as structural data if the compositor needs source env-cell metadata for frontier decisions.
- Avoid storing this as durable diagnostics. This is runtime/debug inspection data, not operational health history.

## Appendix: Reproduction Commands

Inspect the two env cells visible in the user screenshots:

```bash
cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell f4180103
cargo run -p holtburger-debug-harness --bin inspect_env_cell_asset -- --env-cell f418010b
```

Scan the whole landblock for duplicate transformed transition apertures:

```bash
cargo run -p holtburger-debug-harness --bin inspect_landblock_env_cell_bvh -- --landblock f418ffff --limit 0 --portal-duplicates
```

Expected high-signal result:

```text
transitionPortalDuplicateSummary transitionApertures=35 duplicateGroups=11

duplicateTransitionPortalGroup members=2
  envCell=0xf4180103 portal=interior-cell/f4180103/portal/01 flags=0x0005 polygon=21 points=7
  envCell=0xf418010b portal=interior-cell/f418010b/portal/00 flags=0x0007 polygon=28 points=7
```
