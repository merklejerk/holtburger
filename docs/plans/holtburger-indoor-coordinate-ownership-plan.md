# Holtburger Indoor Coordinate Ownership Plan

Date: 2026-08-24
Status: implementation complete; dungeon-transition, possession-target transition, and scene-
replacement regressions fixed and verified with one explicit production-harness concession

## Context And Boundaries

### Goal

Make authored EnvCell ownership authoritative across coordinate conversion, collision placement, camera
handoffs, and dynamic-entity motion, even when indoor geometry crosses the nominal 192-by-192-metre
horizontal square of its owning landblock.

### Background

An AC landblock identifies a 192-by-192-metre horizontal outdoor column. Outdoor positions may derive
their canonical owner from horizontal coordinates. EnvCells do not obey that ownership rule: the cell
DID names the authored owner, while its coordinates are expressed in that owner's frame and may be
negative or exceed 192 metres. Z does not participate in either outdoor or indoor landblock ownership.

The reported failure was reproduced with repository-local production content in dungeon
`0x0007ffff`. The Explorer focused EnvCell `0x00070100` at canonical scene position
`[60, -4.499, -1184]`. That position is horizontally inside the coordinate-derived outdoor column
`0x0006ffff`, but the containing EnvCell remains authored by `0x0007ffff`. After complete collision
interest had loaded, spawning simulated WCID 7 five metres from the camera produced outdoor cell
`0x00060012`, with `reachesOutdoors: true`; after two fixed ticks the entity was grounded outdoors.

The immediate spawn defect is in `explorer_entity_driver::candidate_pose`: it strips the camera's
EnvCell selector and calls `normalize_outdoor_landblock_frame` before portal transit. That changes the
candidate's anchor from the authored dungeon owner to the coordinate-derived outdoor owner, so the
previous EnvCell can no longer participate in transit.

The five-metre baseline is not a pure ownership oracle: the same candidate still exits through real
content geometry after the fix. The ownership defect is isolated by the synthetic crossing fixture
and the exact `0.1 m` production point, which both remain in the authored EnvCell.

A second, independently evidenced ordering defect can produce the reported physical-camera failure.
Explorer target changes start collision simulation interest without awaiting it, then permit physical
camera registration from the rendered dungeon pose. The host snapshots the collision scene at
registration. If the EnvCell product is not committed yet, registration cannot validate the supplied
cell and may reclassify the camera outdoors. Dungeon-only rendering makes the race conspicuous because
large EnvCell products can become renderable on a different schedule from complete collision assembly.
The generic physical-body tick then compounds that failure: its scene-residency result always derives
an outdoor owner from X/Y, even when the accepted pose remains in an EnvCell. For cross-square indoor
poses this can falsely report `MissingOwner`, after which physical fly intentionally continues through
open space. The camera symptom therefore has two proven contributing mechanisms: an ungated initial
snapshot and an indoor-blind post-tick residency derivation.

These failures expose a broader audit requirement, not permission for a speculative coordinate-system
rewrite. Outdoor owner derivation is correct in terrain, outdoor interest, landscape collision, and
many rendering paths. The work must distinguish those proven outdoor consumers from contracts that
can carry indoor poses.

### In Scope

- Prove and document the ownership and coordinate-frame rules for outdoor cells, building EnvCells,
  and dungeon-only EnvCells from ACE, ACViewer, retail decompile evidence, and shipped content.
- Census EnvCells whose geometry or representative positions cross their owner's nominal horizontal
  landblock square, including the maximum observed displacement and representative dungeon/mixed
  cases.
- Audit every Rust and TypeScript owner derivation, outdoor normalization, scene-to-AC conversion,
  reanchoring, and retained-position boundary that can receive an indoor pose.
- Correct Explorer spawn, relocation, and replacement placement so the camera's authored owner is
  preserved through portal transit and outdoor normalization happens only after outdoors is committed.
- Make unavailable indoor collision topology an explicit failure rather than silently converting an
  indoor spawn or camera registration into an outdoor placement.
- Make physical-camera entry wait for the collision-interest revision corresponding to its exact
  presented residency and reject a handoff superseded while it waits.
- Audit physical fly, possession boom, generic physical bodies, dynamic contact, placed-motion
  presentation, and frontend scene-residency resolution against the same invariant.
- Add synthetic tests that place an EnvCell outside its owner's nominal square and production-content
  browser-harness scenarios using `0x0007ffff` / `0x00070100`.
- Sweep misleading comments and names that imply every landblock-local indoor coordinate is within
  `[0, 192)` or that every scene point has one coordinate-derived owner.
- Record census results, caller classifications, decisions, and course corrections in this plan as
  implementation proceeds.

### Out Of Scope

- Changing the 192-metre outdoor grid, terrain ownership, outdoor cell derivation, or vertical
  coordinate semantics.
- Treating neighboring outdoor columns crossed by dungeon geometry as additional authored owners or
  loading them as dungeon topology.
- Reparenting EnvCells, rewriting DAT records, or repairing shipped content.
- Replacing `WorldPosition`, all scene-vector brands, or every renderer transform without audit
  evidence that the current contract is unsafe.
- Making renderer scene interest and collision simulation interest one subsystem; they have different
  products and lifetimes even when an operation must await both.
- Reproducing retail loading policy, `SeenOutside` landscape retention, or server landblock activation
  behavior beyond what is required to establish coordinate and ownership semantics.
- Fixing unrelated portal visibility, collision geometry, physical response, or dungeon performance
  defects discovered during verification.
- Modifying ACE, ACViewer, or the retail client decompile.

## Ground Truth

### Primary Reference Sources

- `ACE/Source/ACE.Entity/LandblockId.cs:36-49,71`
  - The high word is landblock identity, outdoor land-cell coordinates are derived only from the low
    outdoor selector, and low words at or above `0x0100` are indoor.
- `ACE/Source/ACE.Entity/Position.cs:118-180,187-204`
  - Both landblock-frame adjustment and outdoor cell derivation return immediately for an indoor
    position. ACE therefore preserves the authored high word and unrestricted local X/Y indoors.
- `ACViewer/ACViewer/Extensions/PositionExtensions.cs:9-29` and
  `ACViewer/ACViewer/Render/R_Landblock.cs:83-102`
  - ACViewer constructs EnvCell DIDs from their authored landblock high word and projects their raw
    frame through that owner's world transform; it does not choose an owner from the placed point.
- `acclient-eor-source/acclient.c:118359-118404,137668-137716`
  - Retail converts between position frames from the two authored cell high words. Z offset is always
    zero, proving that landblock frame translation is a horizontal grid operation.
- `acclient-eor-source/acclient.c:140329-140340`
  - Retail dispatches low words at or above `0x0100` to `CEnvCell` loading and lower selectors to
    landscape loading.
- `acclient-eor-source/acclient.c:446525-446557`
  - `adjust_to_outside` is an explicit conversion to outdoor identity, not a general position
    normalization. It can accept an EnvCell source and replace it with an outdoor GID, so callers—not
    this primitive—must first establish that an outdoor result is semantically intended.
- `crates/holtburger-common/src/position.rs`
  - Current `WorldPosition`, `outdoor_landblock_owner_at`, `reanchor_to_landblock_owner`,
    `normalize_outdoor_landblock_frame`, and `normalize_outdoor_cell` contracts.
- `crates/holtburger-content/src/interior.rs`
  - Canonical EnvCell assembly, authored owner, placement, portal, and bounds facts used by the census.
- `crates/holtburger-content/src/object_collision.rs`
  - Canonical EnvCell collision shells and cell volumes, already placed in the authored landblock frame.
- `crates/holtburger-world/src/spatial/collision.rs`
  - `CellTransitRequest` explicitly pairs an authored anchor with anchor-local coordinates and uses the
    previous EnvCell as portal history.
- `docs/plans/holtburger-3d-dungeon-only-scene-interest-plan.md`
  - Existing evidence that dungeon EnvCells can cross nominal outdoor boundaries while retaining
    authored ownership, and the scene-interest policy already selected for that case.

### Existing Program Patterns

- `apps/holtburger-3d/src/lib/game/scene/scene-graph.ts`
  - Point residency first checks authored EnvCell containment and keeps the EnvCell's owner; only its
    outdoor fallback derives a landblock from scene coordinates.
- `apps/holtburger-3d/src-tauri/src/host_physical_fly_runtime/viewer_projection.rs`
  - Converts canonical scene positions into a supplied authored owner before resolving the supplied
    EnvCell seed. This is a useful pattern, but its missing-topology behavior still requires audit.
- `apps/holtburger-3d/src/harness/browser/BrowserHarnessApp.svelte`
  - Already awaits simulation interest before a simulated spawn, demonstrating the required
    readiness dependency that production currently omits.
- `apps/holtburger-3d/src/explorer/simulation-interest.ts`
  - Revisioned, deduplicated collision-interest policy whose current promise can gate an operation
    without creating a second collision-loading path.
- `apps/holtburger-3d/src/lib/game/motion/host-placed-path.ts`
  - Keeps canonical scene position and host-authoritative residency atomic across frontend handoffs.

### Current Investigation Evidence

- Production-content harness target: automatic dungeon `0007`, focused as `0x00070100`.
- Loaded presentation topology: 205 EnvCells and 476 directed crossings for `0x0007ffff`.
- Focused camera: scene `[60, -4.498999953, -1184]`, authored residency `0x00070100`.
- Baseline fully collision-gated simulated spawn: WCID 7, distance 5 metres.
- Baseline incorrect accepted spawn: cell `0x00060012`, AC coordinates approximately
  `[60, 37, -4.499]`, outdoor membership.
- Baseline after two 33.333 ms entity ticks: still `0x00060012`, grounded outdoors at Z approximately
  `-0.897`.
- Control run using explicit outdoor `0x0007ffff` correctly behaved as outdoor; this proves target
  intent matters and is not evidence against the dungeon reproduction.
- The repository search currently finds 153 textual uses of the broad owner/normalization helper
  family across apps and crates. This is a search superset, not 153 defects; the production caller
  ledger below narrows it before implementation scope is expanded.
- No production files were changed during the investigation.

### Post-Implementation Runtime Evidence

- The exact EnvCell harness scenario now waits for the current collision-interest revision before
  spawning, relocating, or ticking. With camera `0x00070100` at `[60,-4.499,-1184]`, WCID 7 at
  `0.1 m` remains `0x00070100` with `reachesOutdoors: false` and reached EnvCell `[0x00070100]`
  after two fixed ticks and an immediate teleport relocation. The canonical AC coordinates remain
  approximately `[60,-159.92929,-4.5697107]`; browser error/exception output is empty.
- The first post-implementation runtime pass exposed a second defect that unit coverage had not
  reached: the physical solver converted an indoor point to an outdoor coordinate frame and then
  put the indoor cell selector back on it, producing a 192 m coordinate jump on the first tick.
  `anchor_point_to_cell_position` now reanchors accepted points into the committed cell owner's
  authored frame before publishing. The rerun keeps both selector and coordinates stable in the
  same scenario.
- The follow-up audit found the same selector/frame pairing risk at owner-changing portal boundaries
  in dynamic-contact correction, Explorer placement, and boom target seeding. Those callers now use
  the same authored-owner reanchor rather than merely overwriting the low word.
- A `5 m` default camera-relative candidate still exits through the dungeon's actual geometry to
  outdoor `0x00060012`; this is unchanged after the ownership fix and is a legitimate portal/
  containment result, not a reason to force an EnvCell. The acceptance fixture is therefore the
  exact in-cell point plus fixed-tick continuity, while the 5 m run is retained as an exit control.
- The harness cannot invoke the Tauri-only physical-camera registration command or a deterministic
  possession-boom session. Those paths are covered by the shared readiness/currentness gate,
  host-side stale-cell tests, and the full Rust/TypeScript suites; this is a verification boundary,
  not an unresolved ownership decision.
- The mixed outdoor/building control (`0xda55ffff`, building and EnvCell radius 1, immediate
  settlement) loaded 9 terrain, 9 building, and 9 EnvCell batches across 6 landblocks: 299 expected
  cells, 299 shells, 670 apertures, and 168 visible EnvCell scopes. It completed with empty browser
  errors and no ownership substitution.
- The ordinary outdoor seam control placed the camera at local Y 190 in `0xda55ffff`, aimed toward
  the next column, and spawned WCID 7 five metres across the boundary. The accepted endpoint was
  `0xda560021` (the expected outdoor cell in the neighboring owner), with `reachesOutdoors: true`,
  no EnvCell membership, one stable fixed tick, and empty browser errors. This is the browser-level
  proof that outdoor cross-landblock normalization remains intact.
- Follow-up transition testing found a lifecycle edge omitted from the first pass: changing scene
  interest evicts an existing entity's retained EnvCell, and the next collection refresh used to
  `expect` that old cell to be present. The panic occurred while the Explorer publication gate was
  held, poisoning the gate and making later spawn/physical-fly commands report only the poisoned
  lock. Dynamic bodies now enter an explicit `Suspended` activity when their retained topology is
  absent, are excluded from dynamic-contact indexing, and automatically wake when that EnvCell is
  resident again. Direct one-off placement/tick requests still return `UnknownMotionCell` rather
  than treating the body as outdoors.
- A possession-target transition reproduced a separate frontend ownership defect: scene interest
  was replaced while the possession boom still owned camera presentation, so the new target could
  load without ever taking over the visible camera. Explorer target requests now release physical
  and possession camera authority first, coalesce concurrent releases, preserve revision
  currentness, and surface a scene-interest error if release fails. The existing 190-file/1,461-test
  TypeScript suite, app type checks, production build, and formatting checks pass after this change.
- The inverse transition exposed an architectural split: selecting dungeon `0007` after outdoor
  `da55` replaced collision interest but deliberately retained `da55` render demand and every
  explicitly spawned entity. Possession checked only entity identity and motion capability; for an
  outdoor body, boom seeding could accept an outdoor placement even though its collision owner was
  absent. The camera therefore returned to rendered `da55` while scene target and collision interest
  remained `0007`. Render retention was observable semantic state, not an inert cache.

### Archive Census

The retained `env_cell_owner_extent_census` debug-harness binary was run as:

```text
cargo run -p holtburger-debug-harness --bin env_cell_owner_extent_census -- --content dats/assets.hba
```

It inspected authored origins separately from complete transformed CellStruct vertex bounds. Origins
measure placement convention; bounds measure actual geometry. Cell BSP planes are not independently
reported as AABBs because they define unbounded half-spaces, while the complete vertex array is also
the source used to bound collision shells. A one-millimetre edge tolerance excludes rotation noise at
exactly authored boundaries.

| Owner class | Owners | EnvCells | Origins outside | Bounds outside | Empty bounds | Maximum grid displacement |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| All | 3,405 | 729,888 | 637,438 | 651,297 | 0 | 9 |
| Dungeon-only | 1,720 | 611,764 | 597,920 | 610,869 | 0 | 9 |
| Outdoor/mixed | 1,685 | 118,124 | 39,518 | 40,428 | 0 | 5 |

Maximum per-cell grid displacement distribution across all content is: 78,591 at zero; 534,908 at
one; 89,540 at two; 16,270 at three; 4,260 at four; 2,013 at five; 1,306 at six; 1,200 at seven;
1,250 at eight; and 550 at nine. Therefore 110,291 cells extend at least two nominal squares from
their authored owner. This rules out adjacent-column loading as either a correct ownership model or a
bounded workaround.

Representative extrema are:

- negative X: `0x1A8E0104`, X `[-353,-343]` (outdoor/mixed owner);
- negative Y and archive maximum: `0x00B003F3`, Y `[-1595,-1585]` (dungeon-only owner);
- positive X: `0x02AC01F3`, X `[935.5,944.5]` (dungeon-only owner);
- positive Y: `0xF7840174`, Y `[533.515,543.515]` (outdoor/mixed owner);
- crossed corner: `0x00020100`, X `[-1.667,5]`, Y `[-41.667,-38.333]`;
- maximum nine-square displacement: `0x00B00133`, Y `[-1555,-1545]`.

### Production Caller Ledger

| Caller | Input producer | Initial classification | Final resolution/evidence |
| --- | --- | --- | --- |
| `explorer_entity_driver::candidate_pose` | Explorer camera placement | **unsafe** | Fixed by shared spawn/relocation placement: authored anchor survives transit; outdoor normalization is post-commit. Synthetic crossing and exact-cell harness pass. |
| `WorldPosition::normalize_outdoor_landblock_frame` | General `WorldPosition` callers | **invariant gap** | Now rejects real indoor selectors with a typed error; focused common test reaches it. Owner-sentinel handling stays explicit at the frontend boundary. |
| `kinematic_boom::cast_to_reach` and `interpolate_pose` | Indoor-capable possessed target/camera placements | **unsafe** | Cast reanchors accepted coordinates into the committed cell owner; interpolation is documented as coordinate-only. Core crossing test passes. |
| host `target_seed` and physical-fly `pose_with_cell` | Collision-committed placement | indoor-preserving | Retained cell-first behavior; target seeding now reanchors owner-changing portal results, while physical-fly validates its supplied owner. Host tests pass. |
| host visual-pivot interpolation | Explicit coordinate-only world points | outdoor-only | Unchanged; comment states that the value carries no residency. |
| `physical_body_scene_residency` | Final generic physical-body pose | **unsafe** | Reads committed EnvCell membership/owner first and derives outdoor ownership only without a cell. Indoor residency test passes. |
| `physical_body::body_reference_pose` and dynamic-contact endpoint | Collision-committed cell plus anchor-local coordinates | indoor-preserving | Shared solver commit now reanchors cell frames; dynamic-contact correction uses the same helper. Physical tick and cross-owner helper tests pass. |
| dynamic index/contact reanchoring | Explicit shared comparison anchor | indoor-preserving coordinate conversion | Unchanged coordinate-only comparison; residency remains separate and is not re-derived. |
| collision water restriction and `anchor_point_to_outdoor_position` | Explicit outdoor membership/conversion | outdoor-only | Unchanged and remains reachable only from outdoor conversion paths. |
| placed-motion presentation | `PlacedMotionPoint` committed by collision | indoor-preserving | Retained as the canonical cell-owner-first presenter; existing placed-path tests pass. |
| frontend scene-graph point residency | Installed EnvCell scopes plus outdoor fallback | indoor-preserving | Unchanged; authored EnvCell scopes are checked before outdoor fallback. |
| terrain sampling and renderer landblock offsets | Canonical outdoor terrain/render owners | outdoor-only | Unchanged and outside the refactor. |
| production simulated spawn and physical-camera entry | Presented placement before collision interest settles | **unsafe ordering** | Strict current revision, exact placement reread, and possession-owner token now gate host mutation. Delayed transport and app checks pass; browser harness covers spawn/relocation, while Tauri-only registration remains documented debt. |
| stationary `CollisionScene::transit_cell` | Optional prior EnvCell | **invariant gap** | Missing supplied seeds return existing `UnknownMotionCell`; focused world test and stale-body test pass. |

The audit justifies shared enforcement on the existing primitives, but not a new composite pose type:
collision APIs already carry `previous_cell + anchor + coordinates` and placed-motion output already
keeps committed placement atomic. The narrow design is to make outdoor normalization reject indoor
inputs, close the silent stationary-transit fallback, and cut unsafe callers over to the existing
cell-first placement pattern.

## North Stars

1. Authored indoor identity outranks coordinate-derived outdoor convenience.
2. A coordinate frame and a residency are related facts, not interchangeable ways to derive each
   other.
3. Outdoor normalization must be structurally unreachable while an indoor placement remains valid.
4. Missing topology is unavailable knowledge, not evidence that an indoor body is outdoors.
5. Compute placement once at the collision/portal authority; consumers present the committed result
   without re-deriving it.
6. Keep the fix smaller than the audit: proven outdoor paths remain outdoor paths.
7. Every validation failure gets a reachable fixture and one precise error; no silent fallback.
8. Preserve lossless shared semantics suitable for both the Explorer and a future 3D client.

## Phased Implementation

## Phase 1: Prove The Model And Size The Blast Radius

### Deliverables

- Exact ACE, ACViewer, and retail citations for indoor coordinate anchoring, cell identity, outdoor
  normalization, and portal transition.
- A debug-harness census over repository-local client content that records:
  - total EnvCells and owning landblocks inspected;
  - cells whose placed bounds cross one or more nominal owner-square edges;
  - dungeon-only versus outdoor/mixed ownership;
  - minimum/maximum owner-local X/Y extents and maximum crossed-grid displacement;
  - representative cells for negative X, negative Y, X above 192, Y above 192, corners, and more
    than one nominal landblock of displacement if any exist.
- A caller ledger for the production results of searches for:
  - `normalize_outdoor_landblock_frame`;
  - `outdoor_landblock_owner_at` and `landblockAtWorldPoint`;
  - `reanchor_to_landblock_owner`, `reanchor_point`, and `scene_point_to_pose`;
  - coordinate-to-landblock helpers and direct high-word/low-word manipulation.
- Each relevant caller classified as `outdoor-only`, `indoor-preserving`, `unsafe`, or
  `requires-runtime-evidence`, with its named input producer.

### Task Checklist

- [x] Locate and cite the authoritative ACE and retail code paths; do not rely on comments in this
      repository as independent proof.
- [x] Check whether EnvCell origins, complete bounds, collision volumes, or all three are the right
      census population, and record why.
- [x] Implement or adapt a focused archive census in `crates/holtburger-debug-harness`.
- [x] Run the census against `dats/assets.hba` and copy stable aggregate results into this plan.
- [x] Audit the 153-result search superset and remove tests/diagnostics from the production ledger.
- [x] Identify every retained or cross-system contract that can carry a `WorldPosition` with an
      indoor selector.
- [x] Record whether any unsafe caller predates dungeon-only scene interest but only became reachable
      through that feature.

### Acceptance Criteria

- Every proposed production edit in later phases maps to a proven unsafe caller or a demonstrated
  invariant enforcement gap.
- The census has zero unexplained decode/assembly failures.
- The plan contains exact source citations and measured content distribution rather than a guessed
  claim that crossing cells are common or rare.

### Decisions And Course Corrections

- Complete transformed CellStruct vertex bounds are the geometry census. Authored origins remain a
  separate placement census; cell BSP half-spaces are not misrepresented as finite bounds.
- Cross-square ownership is dominant and reaches nine squares, including mixed owners. A dungeon
  classifier or adjacent-column workaround would therefore be incorrect.
- The unsafe callers predate dungeon-only scene interest. That feature made them reachable and
  observable from Explorer; it did not create the invalid assumption.
- Implementation stayed within existing placement and residency contracts: the audit did not justify
  a new global coordinate-system abstraction.

## Phase 2: Resteer Around The Evidence

### Deliverables

- A dry run of Phases 3-6 against the caller ledger and census distribution.
- A decision on the narrowest deserved enforcement mechanism:
  - local control-flow fixes using existing types;
  - new explicit indoor/outdoor methods on `WorldPosition`; or
  - a composite anchored-pose type if multiple independent callers otherwise remain able to make
    the same illegal transition.
- A finalized list of unsafe call sites and regression scenarios.

### Task Checklist

- [x] Reject any abstraction whose only consumer would be the Explorer spawn path.
- [x] Prefer deleting or collapsing duplicate normalization paths before adding adapters.
- [x] Verify that proposed shared changes belong in `holtburger-common` or `holtburger-world`, not in
      renderer or Explorer UX contracts.
- [x] Confirm whether spawn and relocation can share one placement resolver without preserving an
      unsafe intermediate pose.
- [x] Confirm whether physical fly and possession boom share a readiness/registration primitive or
      merely the same precondition.
- [x] Update later phases, risks, and acceptance criteria from the evidence.

### Acceptance Criteria

- The implementation sequence no longer contains speculative callers or hypothetical types.
- Each remaining phase leaves the repository in a coherent, testable state.

### Decisions And Course Corrections

- Do not add a composite anchored-pose type. Existing collision request/output types already express
  the atomic authority; unsafe adapters are failing to consume them correctly.
- Add an explicit indoor-source rejection to outdoor normalization. Keep exact reanchoring available
  as coordinate-only conversion because collision and dynamic-contact comparison genuinely need it.
- Make stationary transit use the existing `CollisionQueryError::UnknownMotionCell` instead of adding
  a second absent-topology error vocabulary.
- Spawn, relocation, and replacement share the same collision placement/commit helper. Camera and
  boom do not share a registration abstraction, but all collision-dependent operations await the
  same revisioned readiness precondition and perform their own post-await currentness check.
- Phase 5 is narrowed to the two additional proven unsafe shared paths—kinematic boom placement and
  physical-body scene residency—plus verification that ledger entries classified safe stay unchanged.

## Phase 3: Make Indoor Placement Atomic And Fix Entity Placement

### Deliverables

- One source-neutral placement operation that accepts:
  - the previous authoritative EnvCell when indoors;
  - its authored landblock anchor;
  - anchor-local candidate coordinates and object collision envelope;
  - the current collision snapshot;
  - and returns the committed pose plus spatial membership without an outdoor-normalized indoor
    intermediate.
- Clean cutover of Explorer spawn, relocation, and replacement preparation to that operation.
- Explicit behavior for a candidate that genuinely exits to outdoors: only the committed outdoor
  result is normalized into the coordinate-derived outdoor owner/cell.
- An error when an indoor seed names topology absent from the collision snapshot; no outdoor spawn
  fallback.
- Outdoor normalization rejects a `WorldPosition` that still carries an indoor selector, so future
  callers cannot accidentally use the conversion as a general canonicalizer.

### Task Checklist

- [x] Add a synthetic cell volume whose coordinates lie outside its owner's nominal square.
- [x] Add a focused `WorldPosition` test proving outdoor normalization rejects an indoor source.
- [x] Prove a stationary and camera-relative candidate remains in that EnvCell.
- [x] Prove a portal path to another EnvCell preserves authored ownership.
- [x] Prove an authored exit portal commits outdoors and then normalizes exactly once.
- [x] Prove ordinary outdoor cross-landblock spawning retains current behavior.
- [x] Route spawn, relocation, and replacement through the same placement decision.
- [x] Remove the unsafe pre-transit normalization and any vocabulary made false by the cutover.

### Acceptance Criteria

- The exact in-cell `0x00070100` production scenario no longer commits WCID 7 as an outdoor cell;
  the separate 5 m candidate remains an intentional geometry-exit control.
- Indoor pose-only and simulated entities retain a committed EnvCell and correct plural spatial
  membership.
- Outdoor candidates still normalize across landblock boundaries.
- Missing indoor collision topology fails with one precise, tested error.

### Decisions And Course Corrections

- `resolve_spawn_placement` is the single Explorer placement decision. It keeps the presented
  authored selector through transit, publishes a committed EnvCell directly, and only clears the
  selector before an accepted outdoor normalization.
- The frontend's `0xXXYYFFFF` outdoor residency sentinel is not sent as an indoor `WorldPosition`:
  the command boundary sends a high-word-only outdoor frame, while EnvCell IDs remain exact. This
  keeps the existing ACE `is_indoors` predicate honest instead of teaching it a frontend sentinel.
- The solver needed the same cell-first rule after the initial placement. `anchor_point_to_cell_position`
  prevents a coordinate-derived outdoor reanchor from being paired with an indoor selector during
  ordinary physical ticks.
- The 5 m production candidate is deliberately not forced to remain indoors; the content's actual
  geometry admits an outdoor exit. The exact 0.1 m point is the ownership continuity fixture.

## Phase 4: Make Camera Handoffs Collision-Ready

### Deliverables

- A production collision-readiness boundary for physical-camera registration using the existing
  revisioned `SimulationInterestController` promise.
- Currentness validation after the await: if scene target, presented placement, runtime lifetime, or
  camera ownership changes, the stale handoff is discarded rather than registered.
- Host-side validation that a supplied EnvCell seed exists in the current collision snapshot; absent
  topology is an error, while a present but geometrically stale seed may still resolve outdoors
  through ordinary portal/containment rules.
- Equivalent readiness enforcement for simulated spawn and any possession-boom registration that
  consumes current scene collision.
- Honest Explorer pending/error presentation while collision readiness is unresolved.

### Task Checklist

- [x] Reproduce delayed collision publication deterministically with an injected transport/source.
- [x] Prove renderer focus can complete before collision interest without enabling physical actions.
- [x] Await exact-anchor simulation interest before simulated spawn and physical/boom registration.
- [x] Re-read or identity-check the atomic presented placement after the await.
- [x] Distinguish absent topology from a stale cell whose topology is present but whose point has
      legitimately crossed outdoors.
- [x] Make stationary `transit_cell` return `UnknownMotionCell` for an absent supplied seed, matching
      the existing placed-motion failure mode.
- [x] Ensure a superseded interest revision cannot launch a late camera session or entity mutation.
- [x] Keep collision loading in the host service; do not add frontend DAT knowledge.

### Acceptance Criteria

- Enabling physical mode immediately after dungeon focus either waits and enters at the same EnvCell
  pose or reports a precise failure; it never relocates outdoors.
- Spawning during collision loading has the same guarantee.
- Existing outdoor physical-fly and building-entry behavior remains unchanged.
- Indoor physical-body scene residency is keyed by the committed EnvCell owner, never by crossed X/Y.
- The browser harness and production Explorer use the same readiness semantics rather than the
  harness carrying a private correctness workaround.

### Decisions And Course Corrections

- Readiness is enforced at the existing frontend simulation-interest controller: mutation callers
  await the receipt, require `committed`, check revision currentness, and compare the exact presented
  placement again before entering the host. The same handoff captures possession ownership, so a
  control-owner change cannot launch a late physical, boom, or entity mutation. Renderer focus and
  collision assembly remain concurrent.
- The host still snapshots collision synchronously; no frontend DAT loading or new host async layer
  was introduced. An absent supplied EnvCell now fails as `UnknownMotionCell`, while a present cell
  may legitimately resolve outdoors through geometry.
- Revision identity is intentionally not copied into every host command. If host mutations become
  asynchronous later, they must carry the controller revision (or an equivalent operation identity)
  rather than inferring freshness from landblock IDs.

## Phase 5: Audit And Repair Other Indoor-Capable Consumers

### Deliverables

- Resolution of every `unsafe` or `requires-runtime-evidence` caller from Phase 1.
- Focused verification of:
  - `holtburger-core` kinematic boom projection and camera clearance;
  - host possession-boom registration and placed paths;
  - physical-fly body/viewer projection and owner crossings;
  - grounded and free-sphere pose commits;
  - dynamic contact and spatial indexing;
  - placed-motion presentation and frontend host-path conversion;
  - scene graph point residency, audio, particles, map, and renderer anchor offsets only where their
    input contracts can actually carry indoor positions.
- Comments on unintuitive safe uses explaining why coordinate-derived ownership is valid there.

### Task Checklist

- [x] Start with kinematic boom call sites that normalize `WorldPosition`; possession makes them
      reachable from indoor entities.
- [x] Replace generic physical-body scene-residency derivation with a committed-cell-aware decision;
      retain coordinate-derived owner checks only for outdoor placement.
- [x] For each caller, name the producer and prove whether its pose is outdoor-only.
- [x] Fix unsafe paths by preserving authored residency through the owning placement authority, not
      by sprinkling `if indoors` checks across consumers.
- [x] Add one focused test per distinct failure mode; do not duplicate the same crossing fixture at
      every layer.
- [x] Remove any audit instrumentation and temporary runtime-asset tests after evidence is recorded.

### Acceptance Criteria

- No unresolved indoor-capable normalization or owner-derivation caller remains in the ledger.
- Outdoor-only callers have explicit, honest contracts or comments sufficient to prevent accidental
  reuse with indoor positions.
- No renderer or frontend consumer re-derives a host-committed residency.

### Decisions And Course Corrections

- Kinematic boom returns a pose/cell pair from collision and assigns the committed EnvCell before
  publishing; its coordinate-only interpolation remains explicitly non-residency-bearing.
- Generic physical-body residency now reads the committed cell from the motion response. The shared
  tick commit also reanchors indoor coordinates into the committed cell owner's frame; this was the
  runtime-discovered 192 m jump and is now covered by a focused physical-body regression.
- Owner-changing portal results are reanchored before selector publication in dynamic-contact
  correction, Explorer placement, and boom target seeding; overwriting only the low word is no longer
  an accepted pattern.
- Physical fly, dynamic contact, placed-motion presentation, and scene-graph residency already use
  cell-first branches and were left structurally unchanged except for comments/tests. Outdoor-only
  terrain/water/renderer conversions remain outdoor-only.

## Phase 6: Production-Content Vertical Verification

### Deliverables

- Browser-harness scenarios for automatic dungeon focus at `0007` and exact-cell focus at
  `0x00070100` that exercise:
  - pose-only spawn;
  - simulated spawn and fixed ticks;
  - relocation/reset;
  - physical-camera registration and a stationary/moving tick if exposed by the harness;
  - possession boom if WCID/content capabilities permit a deterministic scenario.
- A mixed outdoor/building EnvCell control and an ordinary outdoor cross-landblock control.
- Machine-readable assertions over accepted cell IDs, authored owners, spatial membership, scene
  position continuity, and browser errors. Screenshots are supplementary, not the oracle.

### Task Checklist

- [x] Extend the harness only as far as needed to invoke the real production paths.
- [x] Assert that the focused camera and entity remain at the same canonical scene point across
      frontend/host round trips within float tolerances.
- [x] Assert no unintended terrain or neighboring-dungeon ownership is introduced.
- [x] Exercise immediate-after-focus operations to cover the readiness race.
- [x] Run the controls against the same build and record concise results here.

### Acceptance Criteria

- The exact in-cell `0x00070100` failure is absent under both settled and immediate-after-focus
  timing; the 5 m geometry-exit control is documented rather than suppressed.
- Spawned entities, physical fly, and boom retain authored dungeon ownership until a proven portal
  transition commits otherwise.
- Browser errors are empty and machine-readable placement assertions pass.

### Decisions And Course Corrections

- The harness now uses the same simulation-interest readiness semantics for scene focus, spawn,
  relocation, and boom projection; pose-only spawn is gated too because host placement still consumes
  collision topology.
- The settled and immediate (`settle-ms 0`) exact-cell run passes after two ticks and a teleport:
  selector `0x00070100`, authored membership only, stable canonical coordinates, and no browser
  errors. An outdoor owner-sentinel control (`0xDA55FFFF`) remains ordinary outdoor behavior.
- The default 5 m candidate exits to `0x00060012` under real geometry, so it is recorded as a
  legitimate exit control rather than treated as a regression. The harness has no Tauri physical-fly
  registration or deterministic boom command; host and app-boundary tests cover those contracts.

## Phase 7: Cleanup, Documentation, And Final Resteer

### Deliverables

- Removal of superseded normalization paths, duplicate readiness workarounds, temporary diagnostics,
  and misleading indoor/outdoor vocabulary.
- Permanent coordinate-frame documentation updated with the authored-owner versus
  coordinate-derived-owner distinction.
- Final caller ledger, census summary, verification record, and any intentionally deferred findings
  recorded in this plan.
- A dry run of the resulting architecture against a future networked 3D client, ensuring the fix is
  not tied to Explorer controls.

### Task Checklist

- [x] Sweep surviving symbols, comments, metrics, tests, docs, and UI labels for retired vocabulary.
- [x] Verify every new field/type has a named consumer and every validation has a reaching fixture.
- [x] Delete temporary runtime-asset tests; retain synthetic unit coverage and canonical harness
      scenarios only.
- [x] Run formatting, TypeScript checks, ESLint, Vitest, Rust formatting, clippy with warnings denied,
      focused Rust tests, and browser-harness gates through package-manager scripts.
- [x] Re-read the final diff for crate-boundary leaks and unnecessary sLOC.
- [x] Update status and decisions in this plan.

### Acceptance Criteria

- The final implementation has one placement authority per decision and no compatibility shim for
  the unsafe behavior.
- Coordinate documentation states that outdoor landblocks own horizontal columns while EnvCell
  authored ownership may cross their nominal squares.
- All required checks pass, or unrelated pre-existing failures are proved and recorded precisely.
- Remaining open questions are resolved or explicitly deferred with owner and consequence.

### Decisions And Course Corrections

- No new shared crate boundary was introduced. The common crate only hardens an existing outdoor
  conversion contract; world owns collision placement/residency; core owns reusable boom behavior;
  Explorer owns readiness and command policy.
- The census binary remains as a deliberate reverse-engineering diagnostic, while runtime-asset
  tests remain harness-only. No debug logging or compatibility fallback remains in production paths.
- Final checks passed: the selected Rust packages reported 36 `holtburger-common`, 431
  `holtburger-world`, 237 `holtburger-core`, and 226 `holtburger-3d` tests (930 total), Explorer
  Vitest reported 1,461 tests across 190 files, and Svelte/TypeScript checks, Prettier, ESLint,
  Knip, and clippy with warnings denied all passed. The browser harness exact-cell immediate
  scenario and both controls passed with empty browser error output. The transition regression is
  covered by the world collection-suspension test.

## Phase 8: Restore Replacement Semantics Across Scene And Possession Authority

### Deliverables

- Replace the renderer's outdoor/dungeon demand union with one current scene-interest map.
- Make every outdoor, dungeon, and clear request replace the complete prior static demand.
- Keep spawned-entity lifetime independent from static streaming, but reject possession when the
  target body is outside the current collision snapshot.
- Make boom registration independently recheck target residency against the exact body/collision
  snapshot it consumes.
- Remove obsolete retained-component types, union helpers, diagnostics, harness fields, tests, and
  current-code vocabulary.
- Mark the superseded retained-window decision in the dungeon-only scene-interest plan.

### Task Checklist

- [x] Collapse `GameRuntime` to one current scene-interest map.
- [x] Clear terrain-fog coverage when dungeon demand replaces outdoor demand.
- [x] Replace component diagnostics with one current-interest snapshot.
- [x] Preserve spawned entities across transitions without presenting them as possessable outside
      collision interest.
- [x] Share the world's canonical physical-body residency computation with the host adapter.
- [x] Reject remote possession before changing semantic possession authority.
- [x] Recheck residency at boom startup to cover interest movement after possession acceptance.
- [x] Add focused renderer replacement and host possession/boom regressions.
- [x] Run complete frontend, Rust, lint, formatting, and production-harness verification.

### Acceptance Criteria

- `da55 -> 0007` evicts all `da55` static layers and leaves exactly `0007` EnvCells in render demand.
- Returning to `da55` reacquires its outdoor layers instead of observing retained materialization.
- A registered `da55` entity may remain semantically inspectable after the transition, but possession
  fails with a named missing-collision-owner error and does not mutate possession authority.
- If collision interest moves after possession, boom startup fails before publishing a camera path.
- Indoor eligibility uses the committed EnvCell owner; outdoor eligibility uses the canonical owner
  already computed by shared physical-body residency semantics.
- No frontend check re-derives target eligibility or races the host collision snapshot.

### Decisions And Course Corrections

- Static presentation, simulation collision, and semantic entity lifetime remain separate products,
  but only entity lifetime may outlive a scene transition. Renderer demand and collision demand each
  have one replacement owner selected by the current scene target.
- The outdoor/dungeon component split and union helper were deleted rather than retained as a dormant
  abstraction. Their only named consumer was the rejected retention policy.
- Entity despawn was not coupled to scene replacement. That would encode Explorer streaming policy
  into semantic lifecycle and conflict with future server-authored spawn/despawn authority.
- Possession and boom validate at the host boundary. The frontend remains responsible for orderly
  camera-authority release during intentional transitions, while the host independently prevents an
  invalid cross-interest camera from being constructed.
- Verification passed with 190 TypeScript files / 1,460 tests and 932 selected Rust tests: 36
  `holtburger-common`, 431 `holtburger-world`, 237 `holtburger-core`, and 228 `holtburger-3d`.
  Svelte/TypeScript checks, ESLint, Knip, Prettier, rustfmt, and clippy with warnings denied passed.
- Both settled and immediate production-content `da55 -> 0007` runs ended with exactly one render
  demand (`0x0007ffff/env-cells`), zero terrain frame inputs, zero outdoor light scopes, and empty
  browser error/exception output.

## Risks And Mitigations

### Risk: The Census Measures Bounds That Do Not Represent Reachable Space

Environment or collision bounds may include conservative geometry beyond actual cell containment.

**Mitigation:** The completed census reports origins and transformed complete CellStruct vertex
bounds separately. Synthetic point-containment tests remain the correctness oracle for transit; the
bounds census sizes distribution and interest assumptions, not reachability.

### Risk: A Broad Type Refactor Creates More Adapters Than Safety

`WorldPosition` is pervasive, while the demonstrated defect is currently one placement path plus a
readiness gap.

**Mitigation:** The completed caller ledger rejects a composite type. Harden the existing outdoor
conversion and stationary transit contracts, then reuse the existing placed-motion authority.

### Risk: Fixing Spawn Breaks Legitimate Outdoor Crossings

The current premature normalization is wrong indoors but supplies expected canonicalization for an
outdoor candidate beyond 192 metres.

**Mitigation:** Normalize only after cell transit commits outdoors, and retain explicit outdoor
cross-landblock controls.

### Risk: Missing Topology And Legitimate Outdoor Exit Are Conflated

Both currently appear as `committed_cell == None`.

**Mitigation:** Check that the supplied indoor seed exists in the installed collision product before
transit. Only a present seed may resolve outdoors through geometry; an absent seed fails loudly.

### Risk: Serializing Renderer And Collision Loading Harms Focus Latency

Awaiting all collision assembly before starting renderer materialization would unnecessarily make two
independent products sequential.

**Mitigation:** Start both concurrently. Gate only operations that require collision authority, and
retain revision/currentness checks at the handoff.

### Risk: Tests Preserve Explorer-Specific Policy In Shared Crates

Spawn distance, camera UX, and pending controls are app-local, while anchored placement semantics are
shared.

**Mitigation:** Test anchored portal/collision behavior in `holtburger-world`; test Explorer command
ordering and UX at the app boundary.

### Risk: The Audit Expands Into Unrelated Rendering Work

Many uses of landblock coordinates are correct anchor-relative rendering math.

**Mitigation:** Require a named indoor-capable producer before changing a consumer. Safe renderer
offset calculations stay untouched.

## Definition Of Done

- [x] ACE, ACViewer, and retail ground truth is cited precisely.
- [x] The archive census completes without unexplained failures and its stable summary is recorded.
- [x] Every relevant owner/normalization caller is classified and no unsafe entry remains unresolved.
- [x] Indoor spawn, relocation, and replacement preserve authored ownership through cell transit.
- [x] Physical fly and possession boom cannot register against absent required collision topology.
- [x] Changing scene interest while possessed releases camera/possession authority before focusing
      the new target, with an explicit error on release failure.
- [x] Missing topology fails loudly; legitimate portal exits still commit outdoors.
- [x] Immediate-after-focus and fully-settled `0x00070100` production scenarios pass.
- [x] Outdoor cross-landblock and mixed building EnvCell controls pass (browser seam endpoint
      `0xda560021`; mixed 9-batch/6-owner control).
- [x] No consumer re-derives a committed host residency.
- [x] Required formatter, linter, typecheck, unit, Rust, and browser-harness checks pass.
- [x] Temporary diagnostics are removed and permanent documentation is updated.
- [x] The final diff preserves crate/app boundaries and contains no dead compatibility path.

## Remaining Implementation Questions

- No ownership question remains open. The deterministic WCID 7 exact-cell fixture is sufficient for
  spawn/tick/relocation; a possession-boom production fixture remains a future coverage enhancement
  because the browser harness cannot call the Tauri registration boundary.
- The existing `SimulationInterestReceipt.revision` is sufficient for frontend post-await identity;
  delayed older publications are covered by an injected transport test. If host operations become
  asynchronous, carry an operation/revision identity across that boundary instead of inferring
  freshness from a landblock ID.

### Explicit Debt And Concessions

- The plan does not change `WorldPosition::is_indoors` to special-case the frontend `0xFFFF` owner
  sentinel. The host command boundary now sends a high-word-only outdoor frame; changing the shared
  predicate would broaden the semantic blast radius without ACE evidence.
- The production-content harness verifies the real Explorer spawn, relocation, fixed-tick, and boom
  projection paths. Physical-camera registration and possession boom remain covered by app gating,
  host tests, and full suites rather than a browser-level Tauri invocation.
- The census diagnostic is intentionally retained for future content audits. It is not runtime
  production code and should be rerun if the shipped archive or EnvCell assembly changes.
- A separate `da55` control enabling explicit-object and generated layers fails before any transition:
  `MapGeometryStore.installOutdoorStatic` reports missing blocker surfaces for setup models
  `0x02000246` and `0x02000300`. The canonical terrain/buildings/EnvCells transition scenarios pass;
  this pre-existing overhead-map source-completeness defect was not folded into scene replacement.
