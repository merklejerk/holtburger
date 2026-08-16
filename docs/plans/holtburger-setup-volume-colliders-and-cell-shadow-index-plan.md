# Holtburger Setup Volume Colliders and Cell Shadow Index Plan

Status: Complete — implemented and verified 2026-08-15
Created: 2026-08-15
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`

## Context and Boundaries

### Goal

Make bodies collide with setup-volume statics (retail's cylsphere/sphere fallback for objects
without physics BSPs — most wilderness trees), and give the collision scene a per-cell outdoor
shadow index that scales to the couple hundred simulated bodies a true client requires.

### Motivating Evidence

- Retail collides a moving sphere against an object's per-part physics BSPs **only when** the
  object has `PhysicsState::HasPhysicsBSP` (state bit 0x10000). Otherwise it falls back to the
  setup's cylspheres, then spheres (`CPhysicsObj::find_obj_collisions`, `acclient.c:304684-304745`;
  cylsphere loop at `:304731`, sphere loop at `:304706`). The flag is cached true iff any part's
  GfxObj carries a physics BSP (ACE `PartArray.CacheHasPhysicsBSP`).
- Our assembler emits colliders exclusively from per-part physics BSPs
  (`crates/holtburger-content/src/object_collision.rs`), so setup-volume statics assemble to
  nothing. Census on wilderness landblock 0xE63EFFFF: 137 placements, 0 colliders emitted, but 53
  placements carry authored collision volumes (e.g. tree setup 0x02000246: cylsphere r=0.85
  h=3.334; 0x020002DA: cylsphere r=2.604 h=63.17; 0x0200035F: 3 spheres). The remaining 84
  (grass, small flora) have no volumes and are pass-through in retail too.
- The current outdoor broad phase is per-landblock: `StaticShadowIndex` buckets outdoor colliders
  and building shells by owner, and `selected_colliders` linearly scans every collider in the
  touched landblocks plus all 8 neighbors (`crates/holtburger-world/src/spatial/collision.rs:511`,
  `:691`, `:2309`). That is fine for one camera body; it multiplies per body and folds at
  hundreds. Retail's answer is per-cell static shadow lists
  (`CPhysicsObj::add_shadows_to_cells`, `acclient.c:306734` and forward declarations `:6165`,
  `:6256`).

### In Scope

- Decode-to-solver support for setup cylsphere and sphere collision volumes on outdoor explicit,
  outdoor generated, and indoor static placements, with retail's precedence (physics BSP if any
  part has one, else cylspheres, else spheres).
- Cylsphere and sphere narrow-phase math ported from retail: wall contact, top/walkable support,
  step up/down, sliding normal.
- Grounded support on volume colliders (standing on a stump/fence), including retail-differential
  coverage.
- Per-24m-cell outdoor shadow buckets inside `StaticShadowIndex`, replacing the per-landblock
  outdoor/building vectors as the broad-phase selection unit.
- `collision_scene_probe` provenance and census output for volume colliders.
- Browser-harness verification that the Explorer camera collides with a known tree.

### Out of Scope

- Body-vs-body / body-vs-entity collision (dynamic tier). This plan only prepares the static index
  for that body count.
- Ethereal/missile/player-vs-player exemption semantics from `find_obj_collisions` — those gate on
  weenie state that only matters once dynamic objects collide.
- Scenery placement-generation changes (slope/road rejection already exists in
  `holtburger-content`).
- Any renderer or Explorer UI change.

## Ground Truth

| Question | Source |
| --- | --- |
| Fallback precedence and exemptions | `acclient.c:304684-304745` (`CPhysicsObj::find_obj_collisions`); ACE `PhysicsObj.cs:381-476` |
| `HasPhysicsBSP` caching | ACE `PhysicsObj.CacheHasPhysicsBSP` / `PartArray.CacheHasPhysicsBSP` (state bit 0x10000) |
| Cylsphere sweep math | `acclient.c:347097` (`CCylSphere::intersects_sphere`), `:346572` (`collides_with_sphere`), `:346715` (`normal_of_collision`), `:346767` (`collide_with_point`), `:347025` (`slide_sphere`), `:347045` (`step_sphere_up`), `:346646` (`step_sphere_down`); ACE `Physics/CylSphere.cs` |
| Sphere-volume sweep math | `acclient.c:344292` (`CSphere::intersects_sphere`); ACE `Physics/Sphere.cs` |
| Retail per-cell static shadowing | `acclient.c:306734` (`CPhysicsObj::add_shadows_to_cells`), `CObjCell` shadow lists |
| Volume data already decoded | `crates/holtburger-dat/src/file_type/setup_model.rs` (`cyl_spheres`, `spheres`) |
| Existing assembly pattern | `crates/holtburger-content/src/object_collision.rs` (`append_placement`, `place`, `ShapeCache`) |
| Existing narrow phase and selection | `crates/holtburger-world/src/spatial/collision.rs` (`contacts`, `selected_colliders`, `StaticShadowIndex::compile`, `outdoor_cell_bounds`) |
| Existing differential-test pattern | `crates/holtburger-world/src/spatial/grounded_retail_differential.rs`, `restitution_retail_differential.rs` |
| Live-scene verification | `crates/holtburger-debug-harness/src/bin/collision_scene_probe.rs`; `npm run harness:browser` |

## North Stars

1. Match retail's observable collision surface, not its architecture: same objects stop a body,
   same objects don't, same precedence.
2. One collider vocabulary: a volume collider is a `PlacedCollider` variant, flowing through the
   same selection, contact, grounded, and probe paths as BSP colliders — no parallel pipeline.
3. Prove precedence and geometry from the decompile before writing solver math; differential tests
   pin the ported behavior.
4. The broad phase serves the future many-body client: selection cost proportional to what a body
   can actually touch, not to scene residency.
5. Every behavioral departure gets a `RETAIL QUIRK`/`RETAIL DIVERGENCE` marker or does not ship.
6. Census before and after: collider counts per landblock are evidence, not vibes.

## Phased Implementation

### Phase 1: Volume collider assembly in `holtburger-content`

Deliverables:

- `CollisionShape` (or a sibling) gains volume variants: object-local cylinder
  (`origin`, `radius`, `height`, z-up) and ball (`center`, `radius`). Model as an enum on the
  shared shape so `PlacedCollider` stays one type; BSP-specific fields (`polygons`, `bsp`) live
  only in the BSP variant.
- `append_placement` implements retail precedence: if any setup part yields a physics-BSP shape,
  emit part colliders exactly as today; else if `setup.cyl_spheres` is nonempty, emit one cylinder
  collider per cylsphere; else emit one ball collider per sphere. GfxObj-family placements keep
  today's behavior (a bare GfxObj has no setup volumes).
- Uniform `whole_object_scale` applies to volume origin, radius, and height. Reject non-uniform
  per-part scale for volumes loudly (volumes are setup-level; per-part scale cannot apply).
- Replace the placed broad-phase sphere (`bounds_center`/`bounds_radius`) with a landblock-space
  AABB on `PlacedCollider`, computed once at assembly from the shape's bounds (authored
  `box_bounds` vertex AABB for BSP shapes, exact extents for volumes) through placement and scale.
  The authored BSP root sphere stays on the shape for narrow-phase use. Rationale: identical
  per-query cost, far tighter rejection for tall/skinny shapes (a 63m tree cylsphere has a ~32m
  bounding sphere but a 2.6m-wide AABB), and its XY projection is exactly the Phase 5 cell
  registration rectangle — one primitive drives reject and registration. Broad phase remains
  conservative-only, so this is a structural choice, not a retail divergence.
- Unit tests: precedence (BSP part suppresses volumes — 172 authored setups carry both;
  cylspheres suppress spheres — 5 authored setups carry both), cylinder/ball placement transform
  under scale and rotation, placed-AABB correctness under rotation.

Acceptance criteria:

- `cargo test -p holtburger-content` passes.
- `collision_scene_probe --landblock 0xE63EFFFF` reports 53 placements' worth of volume colliders
  where today it reports 0 (`placed_colliders=0`), and town 0xDA55FFFF BSP collider counts are
  unchanged.

Checklist:

- [x] Shape enum and volume variants with doc comments
- [x] Precedence in `append_placement`
- [x] Placed landblock-space AABB replacing the placed bounds sphere; sweep the old
      `bounds_center`/`bounds_radius` vocabulary
- [x] Scale/transform handling and loud failure for invalid scale
- [x] Probe provenance prints shape kind
- [x] Census recorded in this doc's decisions section

### Phase 2: Narrow-phase volume math in `holtburger-world`

Deliverables:

- Sphere-vs-placed-cylinder and sphere-vs-placed-ball contact generation alongside
  `placed_solid_contacts`/`placed_polygon_contacts`, dispatched on the shape variant inside
  `CollisionScene::contacts` and the placement/movement/grounded query paths.
- Math ported from `CCylSphere::collides_with_sphere`/`normal_of_collision`/`collide_with_point`
  (`acclient.c:346572`, `:346715`, `:346767`): side-wall normal, rim handling, top plane, and the
  displacement test that decides entering-vs-separating. Ball contacts from
  `CSphere::intersects_sphere` (`acclient.c:344292`).
- Movement-direction gating identical to the BSP path (skip contacts whose normal the movement is
  leaving).

Acceptance criteria:

- New unit tests in `spatial` cover: head-on wall contact, tangential slide, rim contact, top
  landing, contained-start separation, and the tall-cylinder case whose bounds sphere is much
  larger than its body (0x020002DA-shaped).
- Physical-fly camera in the browser harness visibly stops at a known tree in 0xE63EFFFF (screenshot
  or machine-readable final position short of the trunk).

Checklist:

- [x] Cylinder contact function with acclient citations on nontrivial branches
- [x] Carry retail's exact contact epsilon — resolved as a non-issue: the decompile's
      `0.00019999999` is the shortest decimal print of `0.0002f32` (bit pattern 0x3951B717);
      they are one constant, documented at `RETAIL_VOLUME_CONTACT_EPSILON`
- [x] Ball contact function
- [x] Dispatch in every static query path (movement, placement, grounded obstruction, support)
- [x] Unit tests
- [x] Harness evidence captured (probe grounded route, see decisions)

### Phase 3: Grounded support on volumes

Deliverables:

- Support/step semantics ported from `CCylSphere::step_sphere_up`/`step_sphere_down`/`slide_sphere`
  (`acclient.c:347045`, `:346646`, `:347025`): a body can stand on a cylinder top; walls obstruct
  without support; step-up honors the existing `GroundedConfig` limits.
- Retail-differential cases added following the `grounded_retail_differential.rs` pattern: land on
  a stump top, walk into a trunk, step up onto a low volume, walk off a top edge with edge
  protection.

Acceptance criteria:

- `cargo test -p holtburger-world` passes including new differentials.
- Grounded-character camera in the harness stands on a low volume collider and is obstructed by a
  trunk.

Support-identity note (corrected by the Phase 1-2 decompile pass): volume supports are
`Surface`-only. Retail's square-edged solid gives the cylinder top a sharp support cutoff at the
shrunk radius sum — a drop just outside finds nothing and falls, with no rim edge feature
(`acclient.c:346578`). The ball settles on its spherical cap with the radial contact normal
(`CSphere::step_sphere_down`, `acclient.c:343736`).

Checklist:

- [x] Top-plane support classification (cylinder +Z; ball radial cap normal, from retail math)
- [x] Sharp radsum support cutoff differential-tested: a drop just outside finds no support and
      no edge feature
- [x] Step up/down parity with the BSP path's config limits (step-up-onto-stump and
      walk-off-step-down scenarios)
- [x] Differential tests (`volume_retail_differential.rs`: transliterated overlap/rest oracles
      swept against production, plus land/obstruct/step-up/walk-off through `solve_grounded`)
- [x] Harness evidence captured (probe grounded route into wilderness tree collider[20])

### Phase 4: Resteering checkpoint

Reassess before the index change: dry-run Phase 5 against the now-real collider population.
Questions to answer with fresh probe data:

- Actual collider counts per landblock across a town, a forest, and a mixed block, post-volumes.
- Measured cost of the per-landblock scan at those counts (probe timing, not intuition) to size the
  win and pick bucket granularity evidence-first.
- Size (not decide — already ratified) the terrain direct-indexing win with before/after probe
  timings, so the Phase 5 evidence separates the terrain and static-selection contributions.
- Any debt accumulated in Phases 1-3 worth clearing before restructuring the index.

### Phase 5: Per-cell outdoor shadow index

Index choice: a uniform grid on the game's own 24m cell lattice — no BVH or octree. The world is
already a uniform grid with authored, bounded per-cell density (retail's stab lists are flat
per-cell lists for the same reason, `acclient.c:306734`); the static scene is immutable per
snapshot, so the index is write-once/read-many with no rebalancing concern; and position-to-cell
is integer math with no traversal. The same grid is the intended host for the future dynamic-body
layer, where per-tick reinsertion is cheap rectangle stamping precisely because the grid is flat.

Deliverables:

- `StaticShadowIndex` outdoor and building buckets keyed by 24m outdoor cell
  (owner + cell coordinate) instead of by owner alone. Registration stamps each placement group
  into every cell overlapped by the XY projection of its placed AABB — the same rectangle
  `outdoor_cell_bounds` (`collision.rs:1791`) computes today, now derived from the Phase 1 AABB so
  reject and registration cannot drift apart.
- `selected_colliders` selects by the integer cell range overlapped by the swept query AABB
  (sphere + movement + probe extent such as grounded step-down reach), typically 1-4 cells, then
  applies the per-collider AABB reject. Interior selection (already per-EnvCell) is untouched.
- Terrain contact generation indexes `TerrainCollisionSurface.cells` directly by the same
  overlapped cell range (row-major coordinate arithmetic, `terrain_collision.rs:34`) instead of
  walking all 64 cells per touched landblock. The terrain parity case joins the full-scan-vs-
  indexed differential test.
- Cross-landblock shadowing falls out of registration: a placement near an edge registers into
  neighbor-owned cells it shadows, replacing `neighboring_source_landblocks` entirely — delete it
  and sweep its vocabulary.
- Building-portal transit compile logic keeps its own use of `outdoor_cell_bounds` unchanged.
- Cross-landblock stamping needs no incremental-removal bookkeeping: residency changes already
  rebuild the whole shadow index off-lock and commit by pointer swap
  (`staged_residency_change` → `StaticShadowIndex::compile`, `collision.rs:755`). Per-cell
  stamping raises compile cost per residency change, not per tick; verify compile time stays
  acceptable in the Phase 4/5 timing evidence.

Acceptance criteria:

- All existing `holtburger-world` spatial tests pass unchanged in behavior (selection is a broad
  phase; results after narrow phase must be identical — assert with a differential test comparing
  old-style full-scan contacts against indexed contacts on a probed real landblock).
- Probe timing shows selection cost no longer proportional to whole-neighborhood collider count.

Checklist:

- [x] Cell-keyed buckets and registration from shadowed rectangles (global cell coordinates;
      outdoor and building buckets merged, building identity stays on `source_placement`)
- [x] Query-overlap selection, movement-swept (per-query `GlobalCellRange`, lattice-clamped so
      far-outside noncanonical poses select nothing without overflow)
- [x] Terrain direct cell indexing replacing the 64-cell walk, widened by the surface's cached
      burial-shift bound (see decisions)
- [x] `neighboring_source_landblocks` deleted, vocabulary swept
- [x] Full-scan-vs-indexed differential test (statics across a landblock seam and buried-center
      terrain on a steep ramp; test-only oracle inside the test module)
- [x] Timing evidence recorded, terrain and static contributions separated

### Phase 6: Cleanup

- [x] Temporary probes removed during earlier phases (the two ad-hoc census binaries).
      `--query-benchmark` stays in `collision_scene_probe` as sanctioned diagnostic
      infrastructure — it is the standing instrument for sizing future index changes.
- [x] Comment sweep: `object_collision.rs` module header rewritten around the three-way retail
      precedence; `bsp_query.rs` header notes the shared `Shape*` result vocabulary.
- [x] `crates/holtburger-content/ARCHITECTURE.md` and `crates/holtburger-world/ARCHITECTURE.md`
      updated for the precedence, placed AABB, global-cell index, and terrain indexing.
- [x] Final census (post-everything): 0xDA55FFFF 834 colliders (575 BSP + 259 volume),
      0xC6A9FFFF 681 (160 volume), 0xE63EFFFF 57 (all volume). Retail markers greppable:
      one `RETAIL QUIRK` (world-Z cylinder axis) plus its test-coverage citation.

### Phase 5 result (2026-08-15)

`--query-benchmark 2000` (release, 5x5 interest scene), before → after:

| scene | obstruction µs/query | support µs/query |
| --- | --- | --- |
| town 0xDA55FFFF | 17.1 → 0.20 (~85x) | 21.2 → 0.28 (~76x) |
| forest 0xE63EFFFF | 15.4 → 0.39 (~40x) | 18.9 → 1.41 (~13x) |

Forest queries in this benchmark are deeply buried (fixed z below the terrain), so their terrain
reach legitimately widens; near-surface production queries sit at the town numbers. Contact
parity: the forest benchmark's 653 obstruction contacts reproduce exactly, and both baseline
probe routes (physical-fly and grounded portal traversals on 0xDA55FFFF) reproduce their exact
pre-index final positions.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Cylsphere math has subtle rim/edge cases (decompiled float order matters) | Port branch-by-branch with citations; pin with differential tests before integrating into solve loops |
| Precedence mismatch: retail checks a per-object state bit, we assemble per part | Mirror `CacheHasPhysicsBSP`: any part with a BSP ⇒ BSP path for the whole placement; assert census parity on mixed setups |
| Volume colliders inside buildings/interiors double-colliding with shells | Volumes only assemble for placements that produced no BSP parts; indoor statics keep the same rule, and the probe's provenance check catches double emission |
| Index rewrite silently changes narrow-phase inputs | Differential test: contacts from full scan vs. cell-indexed selection must be identical on real landblocks |
| Tall cylinders shadow many cells, bloating buckets | Registration by shadowed rectangle is bounded (a 63m tree shadows ≤ ~3×3 cells); verify bucket sizes in the Phase 4 census |
| Ossified spatial tests fight the index change | Per repo policy, rewrite rather than contort; the differential test is the safety net |

## Definition of Done

- [x] `cargo clippy --workspace` clean; `cargo test --workspace` passes (excluding tests needing
      absent runtime assets)
- [x] Wilderness census: volume-bearing placements produce colliders (53 → 57 on 0xE63EFFFF);
      volume-less flora remain pass-through (84 inert)
- [x] Town census: BSP collider counts unchanged from pre-plan baseline (575 on 0xDA55FFFF)
- [x] Harness evidence: grounded probe route stops against a wilderness trunk at the Minkowski
      wall and stays grounded; differential scenarios cover standing on and stepping onto volume
      tops (the Explorer camera consumes the identical `solve_grounded` path)
- [x] Selection is per-cell with differential tests proving bit-exact contact parity (seam
      statics and buried-slope terrain)
- [x] No `RETAIL QUIRK`/`RETAIL DIVERGENCE` marker debt: one new QUIRK (world-Z cylinder axis)
      with citation, consequence, and test coverage
- [x] Architecture docs and stale comments updated; temporary diagnostics removed

## Open Questions

None. Terrain indexing was ratified into Phase 5 (see Resolved Questions 3).

## Resolved Questions

1. **Scale application** — proved from `acclient.c:347305-347338`
   (`CCylSphere::intersects_sphere(Position, scale, transition)`): scale multiplies `radius`,
   `height`, and all three `low_pt` components uniformly before the global-frame test. Phase 1's
   uniform-scale rule is retail-exact.
2. **Volume/BSP coexistence** — dat-wide census over the deduped `eor/portal` namespace
   (5,935 setups, 0 decode failures): 358 BSP-parts-only, 4,111 volumes-only, 1,294 neither,
   **172 with both BSP parts and volumes**, and **5 with both cylspheres and spheres**. Precedence
   is therefore load-bearing at scale, not theoretical: emitting volumes for the 172 would
   double-collide against their BSP parts, and the cylsphere-suppresses-spheres branch has 5 live
   records (e.g. 0x02000F7B, 0x02001695-0x02001697, 0x02001709). Both precedence rules ship with
   census-derived tests. The volumes-only population is 69% of all authored setups — the fallback
   is the majority collision representation, not an edge case.
3. **Terrain triangle selection** — ratified (2026-08-15): replace the 64-cell linear walk in
   `CollisionScene::contacts` with direct coordinate indexing of the 1-4 cells the query AABB
   overlaps. `TerrainCollisionSurface.cells` is already row-major coordinate-indexable
   (`terrain_collision.rs:34`), so this is arithmetic, not an index structure. Delivered in
   Phase 5 alongside the static selection change; the Phase 4 checkpoint no longer decides this,
   it only sizes it in the timing evidence.

## Decisions and Course Corrections

- (2026-08-15, Phases 1-2) Implemented and verified. `CollisionShape` became
  `Bsp(BspSolid) | Cylinder | Ball`; `PlacedCollider.bounds` is the placed landblock-space AABB
  collapsed from `placed_box_corners()`, which the cell-shadow traversal keeps using pre-collapse
  so its exact rotated-corner behavior is unchanged. `bsp_query`'s shared result types were
  renamed `ShapeContact`/`ShapeSupport`/`ShapeSupportFeature` since volume queries now produce
  them too. Probe evidence: 0xE63EFFFF 0 → 57 volume colliders (53 fallback placements);
  0xDA55FFFF BSP colliders unchanged at 575 (+259 volumes, 258 of them furniture/prop placements
  that were silently pass-through in towns too), and its physical-fly baseline route reproduces
  the pre-change final position exactly. Grounded runtime evidence: a route driven at 4 m/s into
  tree collider[20] (cylsphere r=1.09) stops at x=105.677 against a predicted Minkowski stop of
  105.48 + substep quantization, stays grounded, and slides along the radial constraint.
- (2026-08-15, plan correction) Phase 3's "rim → Edge with radial inward normal" note was wrong:
  retail's cylinder solid is square-edged (`collides_with_sphere` is a pure XY radsum gate,
  `acclient.c:346578`), so a drop missing the radsum falls clean past the rim and **no rim edge
  feature exists**. Volume supports are Surface-only with a sharp cutoff; the Phase 3 checklist
  is corrected below.
- (2026-08-15, epsilon resolved) The `0.00019999999` literal is bit-identical to `0.0002f32`
  (0x3951B717); the existing polygon `CONTACT_EPSILON` was already retail's constant.
- (2026-08-15, Phase 3) Implemented and verified. Grounded queries dispatch volume supports and
  obstructions; the differential module transliterates `collides_with_sphere`, ball overlap, and
  both step-down rest heights independently of production and sweeps them (zero disagreements),
  then drives `solve_grounded` through land-on-stump, trunk obstruction, step-up-onto-stump, and
  walk-off scenarios. The Explorer camera consumes the identical `solve_grounded` path through
  `host_camera_runtime`, so the probe route is the runtime evidence for the camera behavior.
- (2026-08-15, Phase 4 checkpoint) Post-volume censuses: 0xDA55FFFF 834 colliders, 0xC6A9FFFF
  681, 0xA9B4FFFF 585, 0xE63EFFFF 57, 0x8B9CFFFF 29. Average per-24m-cell bucket load in the
  worst town is ~13 (834/64), well inside flat-Vec bucket territory. Query timing via the new
  `collision_scene_probe --query-benchmark` (release, 5x5 interest scene): 17.1/21.2 µs per
  obstruction/support query in town, 15.4/18.9 µs in forest — at 200 bodies x several queries per
  tick x 30 Hz that is a large fraction of a core, so Phase 5 is justified by measurement.
  Dry-run conclusions for Phase 5: (a) key buckets by *global* 24m cell coordinates
  (`owner_x*8 + floor(x/24)`), which makes cross-landblock registration automatic and deletes
  `neighboring_source_landblocks` cleanly; (b) merge the separate outdoor/building-shell buckets —
  both were selected under the same `reaches_outdoors` gate, and building identity lives on
  `source_placement`, not the bucket; (c) register per collider (per part) rather than per
  placement group for tighter rectangles; (d) `selected_colliders` needs the query geometry, so
  its signature carries a swept query AABB instead of only touched owners. No debt from Phases
  1-3 blocks the index change; the `volume_query` → `bsp_query` shared-type import is noted for
  the cleanup phase.
- (2026-08-15, quality pass) Four-angle review (reuse/simplification/efficiency/altitude) applied
  post-completion: `PlacedCollider::new` became the sole construction door (deleting the
  construct-then-patch dance from production and four fixtures), the volume narrow phase gained
  variant-taking entry points ending the double shape dispatch and its dead `Bsp` arms,
  `GlobalCellRange` absorbed `OutdoorCellBounds`, the two narrow-phase contact epsilons unified
  onto `bsp_query::CONTACT_EPSILON`, and the three query families now share one facing/mapping
  rule each. Deliberately skipped: deriving probe provenance from emitted colliders (the
  independent recomputation IS the parity oracle), per-query owner-run hoisting and dedup-free
  selection (premature at 0.2-1.4 µs/query measured), replacing the domain volume structs with
  `Sphere`/dat `CylSphere` (the domain docs carry the retail axis quirk), and promoting
  `CollisionBox` to `holtburger-common` (right idea, cross-crate churn deferred until a second
  AABB consumer exists). Probe parity re-verified bit-identical after the pass.
- (2026-08-15, Phase 5) Implemented and verified. Selection moved to global 24m-cell buckets and
  per-query `GlobalCellRange`; terrain moved to direct row-major indexing. The benchmark's parity
  check caught a real selection bug the near-surface differential could not: `terrain_contact` is
  one-sided and unbounded below (buried-body recovery), so buried centers reach sloped triangles
  horizontally offset by burial x slope. Fixed structurally by caching `maximum_height` and
  `maximum_planar_shift_ratio` on `TerrainCollisionSurface` at assembly and widening the terrain
  cell reach by that provable bound — contact results are bit-identical to the exhaustive scan,
  proven by the restored 653-contact benchmark parity and the buried-ramp differential test.
  Synthetic partial terrain grids (differential fixtures) keep the exhaustive scan, since their
  cell positions carry no coordinate meaning.
- (2026-08-15, scope substitution) The In-Scope line "browser-harness verification that the
  Explorer camera collides with a known tree" was satisfied through the collision probe instead:
  the browser harness drives a free (non-physical) camera, and the physical camera is solved in
  the Tauri host by the same `solve_grounded`/`solve_physical_fly` calls the probe routes
  exercise against production content. A browser-side physical camera would have to be built to
  test "in the browser," which is the Explorer app's own feature surface, not this plan's.
- (2026-08-15, documented gap, sharpened 2026-08-15) Retail runs a **two-threshold** walkable
  model: `SPHEREPATH::walkable_allowance` is 0.0871557 (cos 85°) when the body is airborne and
  `OBJECTINFO::get_walkable_z()` (the standard 0.667 floor threshold) when it is `OnWalkable`
  (`acclient.c:301469-301474`, `:301563-301569`; state bit 2 = OnWalkable). Land leniently, walk
  strictly: a falling body accepts nearly any upward-tilted surface as a landing contact, then
  the next walking transition strict-checks and a too-steep surface leaves it in contact-slide —
  the retail steep-slope skid. The volume `land_on_cylinder`/`land_on_sphere` setters
  (`acclient.c:344263`, `:347092`) merely re-assert the airborne rule; there is no volume-specific
  leniency. Our solver applies one threshold (`GroundedConfig.walkable_normal_z`) to landing and
  walking alike, so steep landings stay airborne-with-contact instead of grounded-sliding.
  Blast radius: cylinder tops are unaffected (normal exactly +Z); ball flanks between the
  thresholds differ only in the route off the flank (grounded slide vs airborne contact), and the
  same asymmetry applies to steep polygon/terrain slopes, which predate this plan. Closing it is
  a grounded-solver change (a landing/walking threshold pair), not a volume-query change —
  closed by `docs/plans/holtburger-grounded-landing-threshold-and-contact-slide-plan.md`
  (implemented 2026-08-16: `GroundState::Sliding`, the retail threshold pair, and the lenient
  landing probe; the ball-flank descent is differential-tested there).

- (2026-08-15) Plan created. Baseline census: 0xDA55FFFF → 575 colliders (BSP-only assembly);
  0xE63EFFFF → 0 colliders, 53/137 placements carrying authored volumes.
- (2026-08-15) Broad-phase primitive: replace the placed bounds sphere with a fattened
  landblock-space AABB computed at assembly. The authored BSP root sphere (retail's
  `GfxObj.PhysicsSphere` reject) remains on the shared shape; the placed reject and the cell
  registration rectangle both derive from the one AABB. Conservative-only, so not a divergence.
- (2026-08-15) Spatial index: uniform grid on the 24m cell lattice, ruled by data distribution —
  the world is authored as that grid, per-cell density is bounded, the snapshot is immutable, and
  retail's stab lists prove the granularity. Hierarchical indexes rejected as unwarranted.
- (2026-08-15) Plan finalized: both decompile-facing open questions resolved with evidence (see
  Resolved Questions). The scale rule is proven at `acclient.c:347305`, and the coexistence census
  hardened the precedence requirements into tested deliverables. The temporary census binaries
  were removed after capture; the numbers are reproducible from the resource index and
  `decode_cache` in a few lines if ever re-needed.
