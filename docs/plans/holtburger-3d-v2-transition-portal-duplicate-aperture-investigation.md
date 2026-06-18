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

## Implementation Step

Replace V2 transition aperture geometry sourcing with building-side portal
geometry for landblock-building transitions, surfaced through the outdoor
landblock asset route.

Phased execution:

1. Rust outdoor payload shape - complete

   - Extend `LandblockOutdoorAsset` with prepared building transition aperture
     records.
   - Extend host JSON/binary contracts and TypeScript DTOs to carry the
     prepared records.
   - Use synthetic unit tests only. Do not add tests that require repo-local or
     user-local runtime DAT/HBA assets.
   - Completed: added a required `buildingTransitionApertures` field to the
     V2 landblock outdoor payload contract. Rust assembly currently emits an
     empty list until Phase 2 extracts real `PortalPoly` geometry.
   - Completed: added synthetic Rust serialization coverage and synthetic TS
     contract validation. No asset-backed fixture test was added.
   - Spicy implementation note: the field is intentionally required, not
     optional. A landblock outdoor payload should explicitly say "no prepared
     building transition apertures yet" with an empty list instead of letting
     consumers guess whether the producer is old, broken, or merely empty.

2. Building `PortalPoly` extraction - complete

   - In `LandblockOutdoorAssetAssembler`, load each outdoor building instance's
     source `GfxObj` and walk `drawing_bsp` `PortalPoly` records.
   - Resolve `PortalPoly.portal_index` to the building instance's `CBldPortal`
     metadata and `PortalPoly.poly_id` to the source drawing polygon.
   - Transform polygon points into landblock render-local space.
   - Omit mismatches with debug diagnostics instead of falling back to env-cell
     aperture geometry.
   - Validate manually with the debug harness against `0xf418ffff`; do not
     check in an asset-backed fixture test.
   - Completed: `LandblockOutdoorAssetAssembler` now emits real
     `building_transition_apertures` from each outdoor building GfxObj drawing
     BSP `PortalPoly`.
   - Completed: `PortalPoly.portal_index` resolves to the building
     `CBldPortal` metadata and `PortalPoly.poly_id` resolves to drawing polygon
     points transformed into landblock render-local space.
   - Completed: mismatches produce omission diagnostics and never fall back to
     env-cell outside-transition aperture geometry.
   - Completed: synthetic unit coverage verifies successful extraction and
     unmatched-portal omission without runtime DAT/HBA fixtures.
   - Manual validation: `inspect_landblock_building_portals --landblock
     f418ffff --portal-duplicates` reports `buildingPortals=35` and
     `buildingTransitionApertures=35`.

3. V2 static commit route - complete

   - Emit building-sourced `TransitionApertureBatch` resources from the outdoor
     static/building bake path.
   - Move transition aperture retention keys for these resources to the
     `outdoor-buildings` domain instead of `landblock-env-cells`.
   - Update filtering/eviction so outdoor-sourced aperture batches survive and
     expire with outdoor building residency.
   - Replace mandatory env-cell ownership in `TransitionApertureRange` with a
     source variant that can represent building-owned apertures.
   - Completed: `OutdoorStaticObjectsScopePayload` carries prepared
     `buildingTransitionApertures` only for the `outdoor-buildings` domain.
   - Completed: the outdoor static object baker emits an
     `outdoor-buildings`-sourced `TransitionApertureBatch` from those prepared
     records.
   - Completed: `TransitionApertureBatch.sourceDomain` drives coordinator
     retention/eviction, so building aperture masks are keyed to
     `outdoor-buildings` instead of `landblock-env-cells`.
   - Completed: `TransitionApertureRange` now stores source metadata. Building
     aperture ranges carry building portal/source GfxObj metadata. Phase 4
     removed the env-cell fallback source variant.
   - Completed: `StaticSceneQuery` tracks committed transition aperture batches
     directly, including outdoor-building batches that exist before any
     env-cell records are committed.

4. Renderer and debug behavior - complete

   - Keep the WebGL aperture resource upload path batch-oriented.
   - Gate compositing through a resident building aperture on destination
     interior/env-cell scene readiness.
   - Update debug overlay/details to describe building-source metadata for
     landblock-building apertures.
   - Stop treating env-cell outside-transition apertures as mask-producing
     ranges for landblock-building transitions.
   - Remove or hard-disable the legacy `StaticSceneQuery` env-cell-derived
     transition aperture fallback for landblock-building transitions. Env-cell
     outside-transition `CCellPortal` aperture polygons may remain metadata,
     but they must not synthesize `TransitionApertureBatch` resources for
     building apertures when no outdoor-building batch is present.
   - Completed: removed the legacy `StaticSceneQuery` fallback that derived
     transition aperture batches from committed env-cell portal interior
     records. `queryTransitionApertureBatches` now returns only committed
     batches.
   - Completed: stopped the landblock env-cell baker from emitting
     `TransitionApertureBatch` resources. Env-cell `CCellPortal` data still
     participates in interior/static portal records and debug metadata, but no
     longer creates V2 transition mask geometry.
   - Completed: tightened the V2 `TransitionApertureBatch` contract so batches
     are `outdoor-buildings` sourced and range sources are building portal
     sources. This removes the env-cell transition mask compatibility shape
     instead of leaving it as a dead alternate path.
   - Completed: kept WebGL transition aperture resource upload batch-oriented;
     the renderer still uploads committed batches as one aperture resource per
     batch.
   - Completed: portal render-pass activation is now gated above the renderer.
     `ClientRuntime` derives `portal-scene-domains` only when `StaticSceneQuery`
     has committed portal interior scene records for the relevant landblock;
     otherwise it keeps the renderer on `single-surface-resident`.
   - Completed: transition aperture debug overlay primitive ids now include
     building-source metadata: building instance id, building portal id,
     `PortalPoly.portal_index`, `PortalPoly.poly_id`, and source `GfxObj` DID.
   - Spicy implementation note: the renderer-level draw-call readiness guard
     was removed. The renderer now executes the render pass plan it is given;
     semantic portal readiness belongs to runtime/static scene state.
   - Spicy implementation note: the runtime gate is intentionally indoor/outdoor
     scene level. V2 portal compositing treats the world as two renderable scene
     domains, so committed interior scene availability is the readiness signal;
     there is no per-aperture linked-env-cell readiness requirement.
   - Spicy implementation note: building `CBldPortal` flags describe the
     building/outdoor side of a landblock-building aperture. V2 transition
     aperture batches store `frontFace: indoor-visible`, so the building-side
     portal side must be inverted while triangulating building aperture masks.
     The `0xf418ffff` harness output validates this: matched building portal
     flags are opposite their target env-cell outside-transition portal flags.
   - Spicy implementation note: bare `outside` transition aperture mask
     synthesis from env-cell outside-transition portals is intentionally gone
     with this change. That matches this plan's non-goal, but it means any
     future non-building outside transition support needs a new explicit source
     model rather than reviving env-cell fallback synthesis.

5. Building module seam suppression - complete

   - Detect duplicate building-sourced transition aperture polygons after all
     outdoor building aperture records for a landblock have been prepared in
     the Rust outdoor asset assembler.
   - Implementation insertion point: in
     `build_prepared_building_transition_apertures`, collect all apertures from
     `build_building_transition_apertures_from_gfx_obj` exactly as Phase 2 does
     today, then pass the completed vector through a seam-suppression helper
     before returning it to `LandblockOutdoorAsset.building_transition_apertures`.
   - Use a fast canonical cyclic polygon key, not pairwise overlap testing:
     quantize each landblock-render-local point, compute the smallest
     lexicographic rotation of the ordered vertex sequence, compute the same for
     the reversed sequence, and use the smaller sequence as the physical
     aperture key.
   - Implement the key as pure Rust helpers near the existing building aperture
     extraction code:
     `quantized_building_transition_aperture_key`,
     `canonical_cyclic_point_sequence_key`, and a small lexicographic sequence
     comparator over quantized `(x, y, z)` integer tuples.
   - Treat canonical groups with more than one building aperture source as
     snapped-building module seams rather than outdoor transition masks.
   - Emit only singleton canonical groups in the outdoor asset
     `building_transition_apertures` / frontend `buildingTransitionApertures`
     payload.
   - Drop multi-source seam groups inside the assembler. Do not serialize
     suppressed seam groups or duplicate source metadata to the frontend.
   - Do not add new DTO fields, TypeScript contract fields, renderer resource
     fields, or frontend dedupe code. The existing frontend contract should keep
     seeing only `buildingTransitionApertures`.
   - Keep downstream V2 static bake, renderer, and debug overlay code unchanged;
     they should only ever receive mask-eligible outdoor transition apertures.
   - Synthetic Rust coverage:
     - exact same ordered points collapse to zero emitted apertures for a
       two-source seam group;
     - rotated point order collapses to zero emitted apertures;
     - reversed point order collapses to zero emitted apertures;
     - two singleton physical apertures both survive;
     - malformed apertures with fewer than three points are not considered seam
       candidates beyond existing omission behavior.
   - Manual validation command:
     `cargo run -p holtburger-debug-harness --bin
     inspect_landblock_building_portals -- --landblock f418ffff
     --portal-duplicates`. Before the Phase 5 filter, the harness reports
     `buildingTransitionApertures=35 duplicateGroups=11`; after the filter, the
     outdoor payload should contain only singleton mask candidates, and the
     duplicate yellow overlay groups should disappear from V2.
   - Completed diagnostic: `inspect_landblock_building_portals
     --portal-duplicates` now reports building-only duplicate aperture groups.
     For `0xf418ffff`, it reports `buildingTransitionApertures=35` and
     `duplicateGroups=11`.
   - Spicy implementation note: these duplicate building apertures are likely
     intentional modular-building seams. Several pairs come from different
     building instances/source `GfxObj` ids, with opposite portal-side flags and
     disjoint linked env-cell groups, and only become identical after landblock
     placement snaps the modules together.
   - Spicy implementation note: raw ordered points are not sufficient as the
     duplicate key. Some duplicate groups have identical ordered point
     sequences, but others are rotated or reversed. The key must be cyclic and
     reversal invariant.
   - Completed: `LandblockOutdoorAssetAssembler` now filters prepared building
     transition apertures through a canonical cyclic polygon key before
     serializing `building_transition_apertures`.
   - Completed: duplicate canonical groups are dropped inside the Rust
     assembler. No suppressed seam metadata, duplicate-source records, DTO
     fields, renderer fields, or frontend dedupe paths were added.
   - Completed: the key quantizes transformed landblock-render-local points to
     `0.001`, computes the lexicographically smallest rotation for the forward
     point order and reversed point order, and uses the smaller sequence.
   - Completed: synthetic Rust coverage verifies exact duplicate, rotated,
     reversed, singleton-preserving, and malformed-aperture behavior without
     runtime DAT/HBA fixtures.
   - Manual validation: after the Phase 5 filter,
     `inspect_landblock_building_portals --landblock f418ffff
     --portal-duplicates` reports `buildingTransitionApertures=13` and
     `duplicateGroups=0`. Before filtering, the same landblock reported
     `buildingTransitionApertures=35` and `duplicateGroups=11`.
   - Spicy implementation note: the filter intentionally has no "winner." If
     multiple building sources emit the same physical aperture key, the whole
     group is treated as a snapped-module seam and removed from mask
     generation. Ranking by flags, linked env cells, or source order would
     reintroduce an accidental outdoor aperture at an interior module join.

Concrete scope:

- Extend the Rust outdoor landblock asset assembly path
  (`LandblockOutdoorAssetAssembler` / host serialization) to emit prepared
  building transition aperture records for each outdoor building instance.
- In Rust, extract transition aperture polygons from each outdoor building
  instance's source `GfxObj.drawing_bsp` `PortalPoly` records. Do not make the
  V2 frontend reconstruct transition apertures from raw `GfxObj` BSP data.
- Treat `PortalPoly.portal_index` as the index into the landblock `BuildInfo`
  / `CBldPortal` list for that building instance. Validate this mapping against
  `0xf418ffff` before relying on it globally.
- Transform the referenced `PortalPoly.poly_id` polygon points from building
  model space through the building instance placement into landblock
  render-local space.
- Use the matched `CBldPortal` record only for transition metadata:
  building portal id, flags, `other_cell_id`, `other_portal_id`, and `stab_list`
  / linked env-cell ids.
- Serialize the prepared building transition aperture records to the frontend
  with landblock-render-local vertices or polygon points plus source metadata:
  building instance id, source `GfxObj` id, `PortalPoly.portal_index`,
  `PortalPoly.poly_id`, matched `CBldPortal` id/index, flags,
  `other_cell_id`, `other_portal_id`, and linked env-cell ids.
- Update V2 transition aperture batch derivation to consume these outdoor
  building transition aperture records for `landblock-building` transitions.
- Bake and commit landblock-building transition aperture data independently of
  landblock env-cell records. The outdoor landblock asset owns physical
  building aperture geometry; env-cell assets own interior geometry, visibility,
  and env-cell portal metadata.
- Add a V2 committed static record/resource path for outdoor-sourced transition
  apertures, or emit `TransitionApertureBatch` resources directly from the
  outdoor landblock asset path. Do not require `StaticPortalInteriorRecord` /
  landblock env-cell commitment before building transition aperture masks can
  exist.
- Update `TransitionApertureRange` metadata for landblock-building apertures so
  it does not require `envCellId` as the primary owner. Store building/source
  identity (`buildingInstanceId`, `buildingPortalId`, source `GfxObj` id,
  `PortalPoly.portal_index`, `PortalPoly.poly_id`) plus matched `CBldPortal`
  metadata (`other_cell_id`, `other_portal_id`, linked env-cell ids).
- Keep renderer resource lifetime tied to outdoor landblock residency for
  building-sourced aperture masks. The aperture mask may be resident before the
  target env-cell/interior scene is resident.
- Gate portal render-pass activation in runtime/static scene state. A resident
  outdoor aperture mask must not enable portal compositing unless an indoor
  scene exists for the relevant landblock.
- Stop using env-cell outside-transition `CCellPortal` aperture polygons as
  transition aperture mask geometry for landblock-building transitions.
- Remove the legacy env-cell-derived transition aperture query path for
  landblock-building masks. Do not keep it as a silent fallback when
  outdoor-building transition aperture batches are missing.
- Keep env-cell portal records available as metadata/debug data, but do not let
  them create additional V2 transition aperture ranges for the same
  landblock-building aperture.
- Suppress duplicate building-sourced physical aperture groups in the Rust
  outdoor asset assembler before serialization, because those groups are
  building-module seams rather than outdoor transition openings.
- Update transition aperture debug overlay/details to report building-source
  metadata for landblock-building apertures. Do not label these masks as owned
  by an env-cell portal, though matched env-cell ids/portals may be shown as
  metadata.

Acceptance criteria:

- For landblock `0xf418ffff`, V2 transition aperture range count is derived
  from prepared outdoor building transition aperture records, not from the 35
  env-cell outside-transition `CCellPortal` records.
- The `0xf4180103 portal/01` and `0xf418010b portal/00` duplicate env-cell
  aperture pair no longer produces two transition mask ranges.
- Every emitted building-side transition aperture records its source building
  instance id, source `GfxObj` id, `PortalPoly.portal_index`,
  `PortalPoly.poly_id`, and matched `CBldPortal` metadata.
- Building-sourced transition aperture resources commit when the outdoor
  landblock asset commits, even if no landblock env-cell asset has committed.
- If no outdoor-building transition aperture batch is committed for a
  landblock, V2 must not synthesize landblock-building transition mask ranges
  from env-cell outside-transition `CCellPortal` aperture polygons.
- If no indoor scene is committed for the relevant landblock, `ClientRuntime`
  keeps the renderer on `single-surface-resident` instead of asking the renderer
  to perform portal compositing.
- For landblock `0xf418ffff`, duplicate building-sourced physical aperture
  groups detected by the canonical cyclic polygon key are absent from
  `buildingTransitionApertures` and therefore never emit compositor mask ranges.
- The canonical duplicate key catches identical, rotated, reversed, and
  reversed-rotated point orderings after quantization.
- If a building `PortalPoly.portal_index` cannot be matched to a `CBldPortal`,
  omit that aperture with a debug-only omission reason rather than falling back
  silently to env-cell aperture geometry.
- Automated tests use synthetic `GfxObj`/BSP/building data or pure TypeScript
  payloads. No new automated test may depend on runtime DAT/HBA assets that are
  not checked into the repo.

Non-goals for this step:

- Do not solve bare `outside` transitions that have no landblock-building
  endpoint.
- Do not implement env-cell aperture dedupe as a fallback in this same change.
- Do not retain env-cell outside-transition aperture synthesis as a compatibility
  fallback for landblock-building masks.
- Do not use pairwise polygon overlap/intersection tests for building seam
  suppression. Use exact canonicalized transformed aperture identity.
- Do not rank duplicate seam members with flags, `other_cell_id`,
  `other_portal_id`, or linked env-cell lists. Those metadata fields describe
  the building module source and are not reliable winner signals.
- Do not serialize suppressed seam groups or duplicate source metadata to the
  frontend. The frontend payload should stay focused on mask-eligible outdoor
  transition apertures.
- Do not expose raw building `GfxObj.drawing_bsp` traversal as V2 frontend
  transition aperture policy.
- Do not use V1 behavior as an authority for this implementation. Use retail
  `GfxObj` drawing BSP / `CBldPortal` semantics and the decoded asset data.
- Do not add asset-backed fixture tests for `0xf418ffff`; keep that landblock
  as a manual/debug-harness validation case.

Remaining work after Phase 5:

- Decide whether the debug UI needs a richer transition aperture details panel.
  Phase 4 updates overlay primitive ids with building-source metadata, but does
  not add a new visible inspector surface.

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
