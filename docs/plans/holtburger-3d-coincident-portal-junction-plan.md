# Holtburger 3D Coincident Portal Junction Plan

Status: Complete. The pre-existing executor-fixture breakage found during Phase 3 verification was
repaired in passing (see Decisions and Course Corrections).
Branch: `portal-compositing-fixes`
Base: fast-forwarded onto `fix/host-physics-recovery` at `bdfb2806`, which owns the current shapes of
`scene/index.ts`, `scene-graph.ts`, `landblock-layer.ts`, `src-tauri/lib.rs`, and
`src-tauri/Cargo.toml` — every contract file Phases 1 and 2 edit.
Created: 2026-08-12

## Context and Boundaries

### Goal

Let a pixel traverse a zero-thickness scope transit — where one scope's exit aperture is coplanar
with the next scope's entry aperture — by giving the propagation shader a host-proven junction fact
instead of a per-pixel float comparison.

### Problem

Adjacent buildings are authored so that one building's outdoor transition aperture is coincident
with the next building's outdoor transition aperture. Cells are therefore chained through a
zero-thickness slab of the outdoor render domain rather than by a direct cell-to-cell portal.

The propagation fragment shader
(`apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-scope-atlas-programs.ts:349-351`) requires
each advance to lie strictly beyond the plane the pixel arrived through:

```glsl
if ((arrival.route.z & HAS_ENTRY_PLANE) != 0u
    && dot(arrival.entryPlane, vec4(vAnchorPosition, 1.0)) <= PORTAL_QUERY_EPSILON) discard;
```

At a coincident junction that distance is exactly zero, so the advance is discarded, the next scope
never receives an arrival state, and the pixel resolves the outdoor tile instead — grass and sky
through what should be an interior wall.

The CPU culler admits the same advance: `portal-scope-window-culler.ts:1259-1260` suppresses only
the reciprocal crossing or one sharing the same aperture *object id*, and two buildings' apertures
are distinct objects that occupy identical space. Planning and execution therefore disagree about
one geometric fact.

### In Scope

- Host-side detection of coplanar, area-overlapping crossing apertures at HBEC source production.
- A junction group identity on the source crossing record, its decoded schema, and scene topology.
- Junction-aware equal-depth admission in the propagation shader and in both CPU models.
- A logged warning, with degradation rather than failure, for junction groups larger than two.
- Symbolic fixtures proving zero-thickness transit and proving the degenerate path still terminates.
- Browser-harness verification at a real coincident junction.

### Out of Scope

- Changing `PORTAL_QUERY_EPSILON`, depth formats, reverse-Z, or anchor rebasing. Measured junction
  distances are exactly zero or of order 1e-6, so precision is not a contributing factor.
- Synthesizing direct cell-to-cell crossings that bypass the outdoor domain.
- Changing authored topology, Cell BSP containment, collision, movement, or segment tracing.
- Changing the culler's admission rules, the atlas packing, opaque routing, or the resolve pass.
- Adopting retail's terminate-at-exterior-then-restab traversal architecture.
- Adding anything to the source record's `diagnostics` block, or a UI surface for it.
- The collision solver. It fails at these same junctions for an unrelated reason — directed
  reachability cannot cross an `Outdoor` portal because that portal names no far-side cell — and this
  plan changes nothing it reads. Recorded separately in
  `holtburger-world-coincident-junction-transit-investigation.md`; Phase 1's junction pairing is
  available to that work if it is picked up.

## Ground Truth

### Measured Evidence

Gathered on branch `portal-compositing-fixes` before this plan; the tooling is retained.

- `apps/holtburger-3d/src-tauri/src/bin/inspect_coplanar_apertures.rs` — landblock census. For
  `0xF418FFFF`: 24 cells, 71 authored portals, 106 directed crossings, 44 coincident aperture
  footprints, 8 of them spanning three distinct source scopes. The camera cell `0xF4180104` is
  chained to `0xF4180101` behind and `0xF4180106` in front, each through a coincident junction.
- Exact planar overlap (in-plane basis plus triangle SAT) instead of an AABB pre-filter reduces
  same-source-scope coplanar pairs from 78 to 12. The other 66 are adjacent doorways in one wall
  that share a plane and a bounding box but no area.
- Largest mutually-coplanar overlapping exit group for any render domain: **2**, in `0xF418FFFF`
  and across a 15-landblock sample spanning the surface-building range. Never 3.
- Entry-plane distances measured through production packing at the failing pose: exactly `0.000e+0`
  for coincident junctions, `1e-6`–`4e-6` for near-coincident ones, against a `2e-4` tolerance.
  `admittedVertexCount` is `0/N` in every case — total, deterministic rejection, not tolerance
  straddling. Two near-coincident pairs measured `3/6`, which is a hard-edged partial hole.
- The count of blocked junction advances scales with view direction (7 at yaw 90, 45 at yaw 0, 216
  at yaw 180) while per-pair distances are camera-independent. The artifact appears to swim because
  the selected crossing set churns, not because any comparison is unstable.

### Reference Sources

- `acclient-eor-source/acclient.c:441813-441942` — `PView::ClipPortals`. Indoor traversal terminates
  at an exterior endpoint, unioning the clipped window into `outside_view` without recursing.
- `acclient-eor-source/acclient.c:442040-442090` — `PView::ConstructView(CBldPortal*, CPolygon*)`.
  The outdoor pass re-enters buildings gated only on camera sidedness and a non-empty screen clip.
  Retail has no advance-past-the-entry-plane test anywhere in the portal walk; it terminates on
  per-cell visit marking (`cell_view_done`, `update_count`) and empty windows.
- `docs/portal_rendering.md` — accepted compositor model, capacity contract, and the existing
  effective-visibility-aperture preprocessing this work extends.

### Existing Patterns

- `apps/holtburger-3d/src-tauri/src/portal_visibility.rs` — `intersect_visibility_apertures`, the
  established coplanar-pair preprocessing that already runs at source production.
- `apps/holtburger-3d/src-tauri/src/interior_seam.rs` — `classify_indoor_seam`, the existing proof
  that a reciprocal seam is depth-continuous. It is the sole input needed to derive islands host-side.
- `apps/holtburger-3d/src-tauri/src/env_cell_source.rs:465-510` — the diagnostics/hard-failure
  boundary. `ensure!` aborts on our own contradictions (`:709`, non-mutual reciprocal); authored-data
  oddities accumulate into the record's `diagnostics` block (`unresolvedOutsideEndpoints`,
  `unresolvedVisibilityReciprocals`) and production continues.
- `apps/holtburger-3d/src/lib/game/renderer/portal-arrival-metadata.ts` — the 32-byte std140 arrival
  record. `route.x` is the destination domain, `route.y` the suppressed reciprocal, `route.z` flags,
  and **`route.w` (byte offset 28) is unused**.
- `apps/holtburger-3d/src/lib/game/renderer/portal-reference-compositor.ts:243-264` and
  `portal-packed-arrival-state-model.ts:193-231` — the two CPU models that must learn the same rule.

## North Stars

1. Compute the junction fact once, at the host layer that owns aperture geometry. Consumers read it;
   nobody re-derives it from floats at pixel rate.
2. Retail tolerates zero-thickness transit because it never asks the question. We ask it once, at
   build time, rather than adopting retail's traversal architecture.
3. The exemption stays sound only while a domain has at most one usable coplanar exit after
   reciprocal suppression. That bound is the invariant; treat it as load-bearing, not incidental.
4. Authored content is someone else's 1999 data. Odd shapes degrade to today's behavior with a
   logged warning; only our own contradictions abort.
5. The degenerate path must be strictly no-worse-than-current, never a new failure mode.
6. Both CPU models and the GPU must agree, and the symbolic oracle must be able to *fail* on this
   class before it can vouch for the fix.

## Phased Implementation

### Phase 1: Host junction detection

**Deliverables**

- Move visibility-island derivation into the host and **emit it on the record**. See the decision
  below: the frontend currently re-derives islands in `buildVisibilityIslands`
  (`env-cell-realization.ts:199-233`) by union-find over `spatialRelationship.kind ===
  "indoor-depth-continuous"` — a fact the host itself produced via `classify_indoor_seam`. The host
  owns the input and the frontend owns the grouping, which is one derived fact computed in two
  places. Phase 1 emits `visibilityIslandId` per scope on the source record; Phase 2 deletes
  `buildVisibilityIslands` and reads the field.
  **The group-size check requires island identity and cannot use authored scopes instead.** Islands
  merge cells, so a domain's exit set is the union of its members' exits; a domain-level group can
  exceed any single cell's. Checking per authored scope would under-count and miss exactly the
  oversized groups that must degrade.
- Extend `apps/holtburger-3d/src-tauri/src/portal_visibility.rs`, which already owns coplanar-pair
  aperture preprocessing. No second module:
  - `plane_basis`, in-plane projection, and triangle-SAT `apertures_overlap`, promoted from the
    census tool so tool and host share one predicate.
  - `resolve_junction_groups(crossings, apertures) -> JunctionGroups`, grouping crossings whose
    apertures are coplanar (normal alignment and plane offset within tolerance) and share interior
    area. Groups are keyed by source render domain for the size check, but the emitted identity is
    per aperture footprint so both directions of a junction share it.
  - Tolerances as named constants with the census values: normal alignment `1e-3`, plane offset
    `0.05`, minimum interpenetration `0.01`. `intersect_visibility_apertures` gets its coplanarity
    test rewired to the same predicate if they turn out to be the same test under two names.
- `env_cell_source.rs` calls it after `resolve_visibility_apertures` and threads a
  `junction_group: Option<NonZeroU32>` onto `CrossingProjection` and its JSON.
- Island identity is emitted as a **`cellIslandIndices` u32 binary section**, one ordinal per cell,
  parallel to the existing `cellIds` / `cellStructureIndices` / `cellPlacements` arrays. The record
  has no per-cell JSON object to hang a string on — cells are parallel binary arrays indexed by
  `cellIndex` with only `cellCount` in the manifest — and `cellStructureIndices` already sets this
  exact precedent. Crossings *are* manifest JSON, so `junctionGroup` stays a nullable number there.
- Groups larger than two emit `log::warn!` naming the landblock, plane, and participating aperture
  identities, and assign **no** junction id to their members. `log` is the workspace's existing
  logging facade (`Cargo.toml:40`, already used by `session`, `world`, `scripting`, and `tools`);
  `src-tauri` gains the dependency. Nothing is added to the record's `diagnostics` block.
- Collapse `CrossingProjection.relationship` from `serde_json::Value` to a typed enum, serializing to
  JSON at manifest assembly. Island derivation must ask "is this seam depth-continuous?", and reading
  that back out of a JSON blob to make a decision is exactly the untyped-shape smell the surrounding
  code otherwise avoids. Small, confined to the diff, and it is what lets Phase 1 consume the
  classification the host already computed instead of recomputing or string-matching it.
- `ensure!` only where our own derivation could contradict itself: a group whose members are not
  mutually coplanar after assignment.

**Acceptance Criteria**

- `cargo test -p holtburger-3d` passes, including new unit tests for coplanar/overlap/adjacent
  discrimination and for the oversized-group degradation path.
- Re-running the census tool against `0xF418FFFF` and the 15-landblock sample reports the same group
  sizes the tool reports today, proving host and tool agree. Because the tool's island and overlap
  routines have moved into the host, agreement is now structural rather than coincidental.

### Phase 2: Source contract and scene topology

**Deliverables**

- `decode-env-cell-record.ts`: `junctionGroup: z.number().int().positive().nullable()` on the
  crossing schema, and `visibilityIslandId` on the scope schema. The diagnostics schema is untouched.
- Delete `buildVisibilityIslands` from `env-cell-realization.ts` and read the record's field. This is
  the subtraction that pays for Phase 1's addition: one derivation survives, host-side, and the
  frontend stops recomputing a fact it was handed.
- `ScenePortalCrossingInput` (`lib/game/scene/index.ts`) gains `junctionGroupId: number | null`.
- `env-cell-materialization.ts`: `EnvCellScopeMaterializationPlan` gains the island ordinal decoded
  from `cellIslandIndices`; `env-cell-realization.ts` formats it as
  `env-cell-island:${landblockId}/${ordinal}` where `buildVisibilityIslands` used to run.
- `scene-graph.ts` and `landblock-layer.ts` carry the crossing field through unchanged.
- `PortalScopeWindowFrameView` exposes `selectedCrossingJunctionGroupId(ordinal)`.

**Acceptance Criteria**

- `npx tsc --noEmit` clean; decode tests cover both a junction-bearing and a null crossing.
- A record produced by Phase 1 for `0xF418FFFF` decodes with non-null junction groups on the eight
  known three-scope junctions.

### Phase 3: GPU consumption

**Deliverables**

- `portal-arrival-metadata.ts`: name `route.w` as
  `PORTAL_ARRIVAL_METADATA_JUNCTION_OFFSET_BYTES = 28`, zero meaning "no junction".
- `portal-crossing-triangle-stream.ts`: write the junction id into **every** arrival record,
  including the root at `:238`.
  **`route.w` is unwritten, not zero.** `#writeArrivalRoute` populates three of the four uvec4 slots
  and the metadata arena is reused across frames with no `fill`, so slot `w` currently holds whatever
  an earlier camera left there. An unconditional write is required for correctness, not tidiness: two
  stale equal ordinals would satisfy `sameJunction` and admit an equal-depth advance that is not a
  junction, which is precisely the case the convergence bound assumes cannot happen.
- `webgl2-portal-scope-atlas-programs.ts`: admit equal depth when both sides name the same junction.

  ```glsl
  uint candidateJunction = uArrivals[vOutputArrival - 1u].route.w;
  bool sameJunction = arrival.route.w != 0u && arrival.route.w == candidateJunction;
  if ((arrival.route.z & HAS_ENTRY_PLANE) != 0u && !sameJunction
      && dot(arrival.entryPlane, vec4(vAnchorPosition, 1.0)) <= PORTAL_QUERY_EPSILON) discard;
  ```

  Reciprocal suppression still runs first and is unchanged, so the only same-junction candidate that
  can survive is the forward one. **This is exactly why the group-size bound is load-bearing.**

**Acceptance Criteria**

- The existing scope-atlas executor fixture still passes on the real GPU.
- A new fixture case drives an `A -> exterior -> B` chain on one shared plane and observes B's tile
  in the resolved output.

### Phase 4: CPU model parity

**Deliverables**

- `portal-model.ts` scenes gain a per-crossing junction group.
- `portal-reference-compositor.ts:255`: replace `depth <= entryDepth` with a junction-aware rule, and
  make an *unexplained* exact depth tie throw the way the transparent tie at `:382-388` already does.
  A tie is either a proven junction or a modelling error; it is never a silent first-wins.
- `portal-packed-arrival-state-model.ts`: mirror the rule; add a
  `junctionAdmittedCount` counter beside `entryPlaneRejectionCount`.

**Acceptance Criteria**

- `portal-model-metamorphic.test.ts` and the differential culler tests pass unchanged.
- A fixture proves the oracle *fails* on a zero-thickness transit before Phase 3's rule is applied to
  it, so the oracle can genuinely vouch for the fix.

### Phase 5: Steering checkpoint

Reassess before verification: confirm the group-size bound survived contact with the host
implementation, confirm no consumer re-derives the junction fact, dry-run Phases 6 and 7, and record
accumulated debt. Split or reorder what remains if the shader change grew beyond the single
predicate above.

### Phase 6: Runtime verification

**Deliverables**

- Browser-harness capture at the failing pose:
  `--landblock 0xf418ffff --env-cell-camera 0xf4180104 --env-cell-position 46884.13,176,-4668
  --execute-portal --gpu`, before and after, plus screenshots.
- A harness assertion that no *junction* advance is rejected at the pose, distinct from ordinary
  entry-plane rejections which must still occur.
- `--profile-renderer --gpu` comparison confirming the extra UBO read and comparison do not move
  propagation cost measurably.

**Acceptance Criteria**

- Portal mode at the pose matches flat mode's cell population: `0xF4180101` and `0xF4180106` both
  present, no outdoor bleed through the archways.
- Yaw sweep (0/90/180) shows the junction-blocked count at zero while the ordinary entry-plane
  rejection count stays nonzero.

### Phase 7: Cleanup

**Deliverables**

- Delete `portal-entry-plane-probe.ts` and its seams in `webgl2-portal-scope-atlas-pipeline.ts` and
  `webgl2-renderer.ts`, including the `entryPlaneProbe` field on `PortalExecutionProbeResult`.
- Keep `inspect_coplanar_apertures.rs` as an ad-hoc diagnostic. (Its geometry predicates were
  already repointed at `portal_visibility.rs` during Phase 1 to prove host/tool agreement.)
- Update `docs/portal_rendering.md`: the junction fact, the group-size invariant, the degradation
  path, and a note that the entry-plane test is ours rather than retail's.
- Sweep vocabulary: no surviving comment should claim strict depth monotonicity is unconditional.
  `portal-scope-atlas-planner.ts:638-640` in particular states the convergence argument and must be
  amended to name the junction exemption and its bound.

**Acceptance Criteria**

- `grep -rn "entryPlaneProbe\|TEMPORARY INVESTIGATION" apps` returns nothing.
- Format, lint, clippy, type-check, and the full test suite pass.

## Task Checklist

- [x] Phase 1 — host junction detection, diagnostics, degradation
- [x] Phase 2 — source schema, scene topology, delete `buildVisibilityIslands`
- [x] Phase 3 — arrival metadata slot, stream write, shader predicate, junction fixture scenarios;
      all 13 executor-fixture booleans pass on SwiftShader and real GPU (first fully green run
      since the compositor cutover)
- [x] Phase 4 — all four CPU models junction-aware via one shared predicate; tie guard pinned
- [x] Phase 5 — steering checkpoint: bound survived contact; no consumer re-derives the fact
- [x] Phase 6 — portal mode matches flat at both junctions bracketing `0xF4180104` (screenshots
      retained in session evidence); executor fixture 13/13 on SwiftShader and real GPU; GPU frame
      at the pose totals ~0.09 ms, leaving nothing measurable for one added UBO compare to move
- [x] Phase 7 — probe and seams deleted, `docs/portal_rendering.md` gained a Coincident Portal
      Junctions section, planner convergence comment amended, full check/lint/test suites green in
      both languages, census re-verified against the host predicate

## Decisions and Course Corrections

- **Phase 6 deviation: no per-frame junction-rejection counter.** The planned harness assertion
  ("no junction advance is rejected at the pose") required the temporary entry-plane probe, whose
  whole point was to be deleted; GPU shader discards are not otherwise observable per cause. The
  evidence stands on the executor fixture's junction scenarios (positive and negative, real GPU)
  and the portal-versus-flat screenshot match at both junctions of the failing pose.

- **RESOLVED (was BLOCKER): `--fixture portal-scope-atlas` had been broken since the compositor
  cutover, and its repair was approved and folded into Phase 3.** Three stacked pre-existing
  defects, none caused by this plan (verified by stashing all work and reproducing at base and at
  `28fc2498`):
  1. `2eb2770d` (cutover) added the near-plane-straddle scenario but reused the ordinary scenario's
     tile guard, which straddle admission never satisfied — the fixture aborted at startup from
     birth, publishing no booleans, so the cutover's claimed near-plane verification never ran and
     every later commit shipped without this gate. Fixed: the guard now asserts each variant's own
     contract exactly (ordinary `6x6@(3,3)`, straddle `7x7@(2,2)` after the rescale below), chosen
     as **conservative straddle admission is correct** — the wider window is invisible in
     production (the tile metadata is self-consistent) and the field shows no straddle artifacts;
     the revived pixel oracle now vouches for the content rather than the guard blessing it.
  2. `adec7f3f` added the production envelope **gutter** (2-texel dilation rescuing raster
     disagreement at portal boundaries) without rescaling the 4x4 fixture, whose tiles the 5x5
     gutter search spans entirely — every domain leaked everywhere and the nearest tile won all
     pixels. Fixed: the fixture is 12x12 (tile interiors exceed the gutter), and expectations model
     the gutter explicitly — a domain's winnable region is its oracle region dilated by
     `PORTAL_ENVELOPE_GUTTER_RADIUS_TEXELS` (now exported), clipped by its declared window. Pixels
     beyond the dilation must stay root, which is the confinement fact the 4x4 scale could never
     observe.
  3. The straddle scenario's seed (`rootDepth 0.2`) put root opaque *in front of* the aperture, so
     root legitimately won every pixel and the scenario's expected leaf window could never render.
     Never noticed because the scenario never ran. Fixed: root seeds behind the aperture; the
     ordinary-policy negative control still holds because it is blocked by near-plane clipping of
     the straddling aperture, not by source-depth occlusion.
  All 13 fixture booleans — the 11 pre-existing plus the two junction scenarios — now pass on both
  SwiftShader and real GPU (`ANGLE/AMD`), the first fully green run of this gate since the cutover.
- **Phase 4 (done): the plan under-counted the CPU models, and its tie-throw premise was wrong.**
  Beyond the reference compositor and packed model, `portal-arrival-state-compositor.ts`,
  `portal-abstract-executor.ts` (two sites), and `portal-potential-view-plan.ts` all carried the
  identical inline entry test. All five sites now call one shared
  `portalEntryAdvanceAdmitted` helper in `portal-model.ts`; the packed model keeps its
  metadata-slot mirror of the GPU deliberately. The planned "make unexplained ties throw" was
  retracted: `createPortalModelScene` has always rejected equal-depth same-scope crossings at
  construction (`portal-model.ts` `validateLocalDepthTies`), so an in-loop tie throw is
  unreachable dead validation — the guard is instead pinned by a test, and the junction scenes are
  legal precisely because their equal-depth crossings live in different scopes. Tests: oracle
  blocks the zero-thickness transit without ids (the pre-fix behavior), admits it with one shared
  id, still rejects distinct ids, and all three compositor models agree on both variants with
  `junctionAdmittedCount` observing the admissions.
- **Phase 3 (done): junction ids are qualified scene-globally at realization.** Record-local groups
  restart at one per landblock while outdoor is a single render domain, so two landblocks' "group 1"
  must not compare equal in the shader. `qualifyJunctionGroupId` packs the landblock grid above the
  local ordinal (`grid * 0x10000 + group`), stateless and deterministic; a registry in SceneGraph
  was rejected because it would never shrink. Local ordinals above `0xffff` fail loudly.
- **Phase 3 (done): the fixture gained `junctionZeroThicknessTransitMatchesOracle` (shared id
  crosses an equal-depth two-crossing chain into the deep tile) and
  `junctionAbsentEqualDepthIsRejected` (identical geometry without ids keeps today's rejection),
  asserted by the harness alongside the existing booleans.** Unobservable until the blocker above is
  resolved, because the fixture aborts before publishing.

- **Phase 1 (done): the junction overlap predicate reuses `geo` BooleanOps, not the census SAT.**
  `portal_visibility.rs` already projects apertures through `PlaneBasis` and intersects them with
  `geo` for reciprocal visibility synthesis; `apertures_form_junction` uses the same machinery with
  an area floor (`JUNCTION_OVERLAP_AREA_MINIMUM = 1e-4` sq units) instead of promoting the tool's
  hand-rolled triangle SAT. The census tool now calls the host predicate — agreement verified exact
  on `0xF418FFFF` (12/89 pairs, 44 footprints, largest group 2, 12 recurrence pairs) and a
  six-landblock spot-check including both nonzero-recurrence blocks.
- **Phase 1 (done): pure reciprocal pairs receive no junction id.** Every ordinary doorway is a
  two-crossing coincident footprint; tagging them all would put ids on nearly every door for zero
  effect, since reciprocal suppression already covers that pair. A size-two component whose members
  are mutual reciprocals is skipped; a non-mutual reciprocal claim in such a component is an
  `ensure!` (our own contradiction).
- **Phase 1 (done): transitively chained groups must stay mutually coplanar.** Union-find can chain
  partial overlaps across slowly drifting planes; before assigning an id every member pair is
  re-checked with the plane-coincidence gate and a violation fails production loudly. Overlap is not
  re-checked — only the plane fact the exemption's soundness argument uses.
- **Phase 2 (done): one wire name, `junctionGroupId`, on both sides.** The plan had the manifest key
  `junctionGroup` and the contract field `junctionGroupId`; emitting `junctionGroupId` from the host
  removed the rename at the decode boundary.
- **Phase 2 (done): record version bumped 2 to 3.** A new required section (`cellIslandIndices`) and
  required crossing field are a format change; old records now fail loudly at the version literal
  instead of at a missing-section error deep in decode.
- **Phase 2 (done): no `selectedCrossingJunctionGroupId` accessor.** `selectedCrossing(ordinal)`
  already returns the full `ScenePortalCrossingInput`, and the crossing-stream loop already holds
  that object; a parallel scalar accessor would have been a field without a distinct consumer.
  Phase 3 reads `crossing.junctionGroupId` directly.
- **Phase 2 verification:** the real `0xF418FFFF` record emits 12 junction groups of exactly 4
  crossings each — the census's 12 recurrence pairs — including the two junctions bracketing the
  failing camera cell, and every ordinary doorway pair stays null.
- **Phase 1 (done): island ordinals are dense u32s in first-seen cell order**, emitted as the
  `cellIslandIndices` section; the junction domain key is `0` for outdoor and `ordinal + 1` for
  islands.

- **Junction identity over a per-pair exemption table.** A per-arrival bitmask of exempt candidates
  would need 256 bits per record. A group ordinal in the unused `route.w` slot costs one uint and one
  comparison, and both directions of a junction naturally share it.
- **Degrade, do not fail, on oversized groups.** Authored asset shape is not our invariant to
  enforce. Un-exempted crossings keep the strict entry test, so the degenerate path is today's
  behavior scoped to the offending group and cannot break convergence even in principle.
- **Islands move host-side rather than being derived a third time.** The natural reading of "the
  host needs islands" was to add union-find in Rust. That would have made three sites for one fact:
  `classify_indoor_seam` proving depth-continuity, `buildVisibilityIslands` grouping in TypeScript,
  and a new Rust grouping beside it. Instead the host emits island identity and the frontend copy is
  deleted. This expands Phases 1 and 2 beyond the minimum the artifact fix needs, but it is net
  subtractive and it is the only version consistent with computing a derived fact once at the layer
  that owns it. **Accepted.** Verified safe against the active physics branch: the collision solver
  contains no island reference, and none of the three files this touches appear in that branch's
  commits.
- **The group-size check is per visibility island, not per authored scope.** An earlier reading
  assumed authored scopes would do. They will not: islands merge cells, so their exit sets union and
  a domain group can be larger than any member cell's. A per-scope check errs toward declaring groups
  safe, which is the wrong direction for a guard whose whole job is to spot the unsafe case. The host
  therefore derives islands in Phase 1 rather than borrowing the frontend's.
- **Rejected: collapsing junctions into direct cell-to-cell crossings.** Needs N x M synthesized
  crossings per junction, invents topology the authored data does not contain, and handles only
  exact coincidence — the measured `3/6` partial splits would still fail.
- **One module, not two.** Junction detection and `intersect_visibility_apertures` are both
  coplanar-pair preprocessing over the same aperture set at the same stage. A separate
  `portal_junction.rs` would have been two names for one concern. Phase 1 checks whether their
  coplanarity tests are literally the same test and collapses them if so.
- **Warn, do not record.** The oversized-group complaint is a `log::warn!`, not a fourth entry in the
  source record's `diagnostics` block. `unresolvedOutsideEndpoints` and
  `unresolvedVisibilityReciprocals` are schema-validated and read only by tests; that pattern is
  already write-only and does not need extending.
- **Rejected: loosening `PORTAL_QUERY_EPSILON`.** Measured distances are 0 to 4e-6 against a 2e-4
  tolerance with `0/N` vertices admitted. Loosening changes nothing and would delete the convergence
  measure for every ordinary crossing.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| A junction group larger than two exists in unsampled content, making the exemption unsound there. | The group is detected and *not* exempted; those crossings keep the strict test. Diagnostic records it. Convergence cannot regress. |
| An oversized junction group appears in unsampled content and the warning scrolls past unread. | The consequence is today's artifact on that one junction, not a new failure. A `log::warn!` in the content host is visible where the work happens; a fourth write-only diagnostics array would not be. |
| Near-coincident junctions fall outside the plane-offset tolerance and keep failing. | Tolerance chosen from measured data (offsets to 0.3 units observed on partial splits). Phase 6 verifies the specific measured pairs, and the census tool reports what a candidate tolerance would capture. |
| Equal-depth admission makes propagation depend on rasterization order between the two junction crossings. | Only one same-junction candidate survives reciprocal suppression at group size two, so there is no pair to order. Phase 3's fixture covers it; the group-size bound guards it. |
| CPU culler and GPU drift again in some other predicate. | Phase 4 forces the reference compositor to throw on unexplained ties rather than silently first-winning, which is what let this class hide. |

## Definition of Done

- [x] Portal mode renders `0xF4180104`'s neighbours through both coincident junctions, matching flat
      mode, with no outdoor bleed.
- [x] The junction fact is produced once by the host and read by every consumer; no runtime code
      re-derives coplanarity.
- [x] Oversized junction groups degrade with a logged warning and no hard failure.
- [x] All four CPU models agree with the GPU on zero-thickness transit; unexplained same-scope
      depth ties are rejected at scene construction (pre-existing guard, now pinned by test).
- [x] Browser-harness after screenshots (portal versus flat at both junction directions) and a GPU
      profile capture are recorded; "before" is the artifact itself, documented in Ground Truth.
- [x] Temporary investigation code removed; `docs/portal_rendering.md` updated.
- [x] Format, lint, clippy, type-check, and tests pass (Rust 100, TS 1052, fixture 13/13).

## Open Questions

None outstanding. Resolutions are recorded above under Decisions and Course Corrections.
