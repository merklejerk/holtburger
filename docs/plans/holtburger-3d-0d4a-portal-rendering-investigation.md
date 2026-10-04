# Portal rendering investigation: 0x0D4A010F

2026-10-03. Both production corrections are implemented and automated checks pass.
The user accepted the facing fix's improvement to z-fighting, then reported missing
immediate neighbors. The host now also recognizes safe partitioned junctions;
the user has accepted both corrections and requested final review and a commit.

## Context and scope

Goal: explain and correct orientation-dependent missing geometry and unstable
portal composition around EnvCell `0x0D4A010F`, near `42.2S 91.1W`.

The user supplied two screenshots showing large missing sections and jagged,
alternating wall/ceiling coverage. Earlier reports also described portal popping
and z-fighting around the arrival at `@tele 42.4S 91.1W`.

Two rendering failures are reproduced independently: GPU arrival-state capacity
exhaustion and triangle-order-dependent portal ownership. Their exact contribution
to each screenshot remains unmeasured because the screenshot camera pose was not
captured. Follow-up evidence identifies back-facing masks reintroduced after CPU
traversal as a cause of the observed competition. Applying the existing facing rule
to production GPU submission removes order dependence in six problem orientations
and 24 near-plane poses. The 244-pose local survey now has no lost reference rooms
or capacity retreats. Broader content compatibility remains unproven.

The user authorized production implementation with “go ahead,” accepted the
result, and requested code-quality review and a commit. Diagnostics used local DAT
content, temporary scripts in `/tmp`, and in-memory browser instrumentation. No
ACE login, TUI run, or agent visual acceptance check was performed.

The camera settlement fix is a separate completed effort; see
[the camera investigation](holtburger-camera-solid-recovery-investigation.md).
Rendering failures reproduce with an explicitly fixed camera, without running
camera settlement. Network teleport lifecycle and unrelated renderer performance
are outside this investigation.

## Architecture and reference sources

```text
DAT cell geometry and authored portals
  -> app host: reciprocal apertures, seam/island classification, junction groups
  -> app scene: typed cell scopes and directed crossings
  -> app renderer: CPU visibility plan
  -> app renderer: fixed GPU resource admission and whole-frontier retreat
  -> app renderer: per-domain opaque rendering
  -> app renderer: nearest portal arrival per pixel, depth-envelope reduction
  -> app renderer: opaque and deferred composition
```

Host classification and GPU rendering policy belong to `apps/holtburger-3d`.
Any subsequently proven authoritative world semantics must be assessed against
the shared crate boundaries before moving them into `world` or `core`.

Relevant production sources:

- `apps/holtburger-3d/host/src/env_cell_source.rs`: aperture material policy,
  cell islands, junction assignment, and crossing publication.
- `apps/holtburger-3d/host/src/interior_seam.rs`: conservative proof of
  depth-continuous indoor seams.
- `apps/holtburger-3d/host/src/portal_visibility.rs`: reciprocal aperture
  intersection and coplanar-overlap junction classification.
- `apps/holtburger-3d/src/lib/game/renderer/portal-scope-window-culler.ts`:
  CPU visibility selection and atomic frontier rollback.
- `apps/holtburger-3d/src/lib/game/renderer/portal-scope-atlas-planner.ts`:
  separate arrival-ID, triangle-stream, and atlas-packing retreat counters.
- `apps/holtburger-3d/src/lib/game/renderer/portal-arrival-metadata.ts` and
  `portal-propagation-metadata.ts`: R8UI arrival IDs and fixed UBO layout.
- `apps/holtburger-3d/src/lib/game/renderer/portal-render-capacity-policy.ts`:
  configured CPU and GPU limits.
- `apps/holtburger-3d/src/lib/game/renderer/portal-scope-atlas-command-model.ts`:
  strict `LESS` propagation, envelope reduction, and final `LEQUAL` resolve.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-scope-atlas-programs.ts`:
  synthetic mask depth bias, entry-plane admission, source occlusion, and resolve.
- `apps/holtburger-3d/src/lib/game/renderer/portal-reference-compositor.ts`:
  existing semantic reference and documented protrusion behavior.

Retail inspected: `acclient-eor-source/acclient.c:433600-433675` for aperture
depth handling; `:441205-441240` for cell rendering order; `:441813-441942`
for `PView::ClipPortals`. These references establish relevant behavior, but do
not yet settle the correct treatment of this site's competing masks. Consult
ACE and ACViewer as appropriate for source topology and data interpretation.
Do not modify the retail decompile.

## Reproduction configuration

All reported poses use the cell's authored bounds center, not the exact user
screenshot position:

- Camera cell: `0x0D4A010F`; owner: `0x0D4AFFFF`.
- Canonical scene position: `(2604, 23.600000381469727, -14338.800003051758)`.
- Pitch zero except where noted in the survey; FOV 90°, near 0.5, far 2000.
- Browser viewport and drawing buffer: 1280 × 720; render scale 1.
- Real GPU: AMD Radeon 780M, RADV PHOENIX through ANGLE/Vulkan.
- Debug content host; 51 loaded cell shells and 342 aperture geometries.
- Production portal mode and capacities. No performance benchmark claims.

From `apps/holtburger-3d`, reproduce the angle and cell-boundary survey:

```sh
HOLTBURGER_PROBE_PORTAL_TRAVERSAL=1 HOLTBURGER_PROBE_PORTAL_SURVEY=1 \
npm run harness:browser -- --brief --gpu --measure-ms 1000 \
  --landblock 0x0d4a010f --env-cell-radius 0 --explicit-object-radius 0 \
  --env-cell-camera 0x0d4a010f --env-cell-position center \
  --camera-yaw 0 --camera-pitch 0 --frame-mode portal
```

For the capacity collapse alone, use yaw 145° and omit the survey environment
variables. The diagnostic content server and browser require local socket access.

## Finding A: arrival-state capacity drops complete visibility layers

The frontier texture uses R8UI: zero means uncovered, leaving 255 nonzero arrival
states for the root plus retained directed crossings. The planner deliberately
removes deepest complete visibility frontiers until the workload fits.

At the fixed center and pitch zero:

| Yaw  | Retained cells | Exact CPU reference cells | GPU frontier retreats |
| ---- | -------------: | ------------------------: | --------------------: |
| 140° |             38 |                        35 |                     0 |
| 145° |              2 |                        39 |                     4 |
| 180° |             35 |                        37 |                     3 |
| 220° |             38 |                        35 |                     0 |

The production CPU uses conservative rectangles, so retaining more cells than
the independent exact CPU reference is permitted; losing reference-visible cells
is the relevant failure signal. This reference checks CPU scope retention, not
the final correct image.

The 244-pose survey had 23 cases with lost reference scopes. All 23 reported GPU
retreat and truncation; no complete case lost reference scopes. The 108 checked
cell-boundary poses had no such failures. This is evidence for the tested poses,
not a global content census.

The separately captured planner trace at yaw 145° identifies the resource:

- Arrival-state capacity retreats: 4.
- Atlas packing retreats: 0.
- Crossing triangle stream retreats: 0.
- Retained result: 2 cells, 6 crossings, depth 1.
- CPU projection operations: 21,043, below the configured 240,181 allowance.

Thus increasing the CPU budget does not address this reproduction. Widening the
ID format requires reviewing the metadata layout as well: the current camera,
arrival, and scope UBO layout exactly fills WebGL2's guaranteed 16 KiB block.
Other resource limits may become visible after removing the first bottleneck.

## Finding B: competing portal masks depend on triangle submission order

The diagnostic retains a fixed camera, source geometry, metadata, and scope
atlas. It runs the production compositor into a temporary color/depth target,
then reverses only the expanded portal triangle order, preserving triangle
winding, vertex attributes, and arrival IDs. It compares output color pixels,
per-round frontier IDs, and depth-envelope texels numerically.

| Yaw  | Changed output pixels | Changed envelope texels | GPU retreats | GL errors |
| ---- | --------------------: | ----------------------: | -----------: | --------: |
| 90°  |                39,313 |                  97,003 |            0 |         0 |
| 130° |                 2,085 |                   4,285 |            0 |         0 |
| 140° |                13,183 |                  24,699 |            0 |         0 |

The first three propagation rounds match; IDs begin differing in round four.
At yaw 140°, that round differs at 7,257 pixels. Subsequent envelope differences
include coverage changes, not merely a small floating-point perturbation.

Observed competing outdoor-to-cell destinations include:

- At yaw 90°: `0x0D4A011F` versus `0x0D4A0110`.
- At yaw 130°: `0x0D4A0111` versus `0x0D4A011E`.
- At yaw 140°: `0x0D4A0120` versus `0x0D4A012C`, and
  `0x0D4A0121` versus `0x0D4A012D`.

The last two pairs have nearly coincident planes and no junction group. At yaw
90°, all 108 retained crossings are exterior transitions with allow-equal-depth
mask policy; 46 have junction identities. These counts describe that pose only.

Controls and interpretation:

- Rendering identical triangle order twice changes zero output pixels at yaw
  90°, 130°, and 140°, with zero retreats and GL errors.
- Replacing the frontier's DEPTH_COMPONENT24 attachment with DEPTH_COMPONENT32F
  reproduces exactly the same reported color, envelope, and frontier differences
  at yaw 90° and 140°. This particular format change is not a remedy.
- Strict nearest-depth selection lets equal raster depths resolve by submission
  order. The experiment proves order-dependent ownership and composition. It does
  not yet prove which destination, or combination of destinations, is correct.
- Triangle order is the experimental variable; camera orientation sensitivity
  of this same failure still needs a small-angle differential capture.
- Temporary targets omit the ordinary scene background and subsequent deferred
  passes. Counts are diagnostic compositor differences, not screenshot diffs.

An early frontier readback inspected the output read framebuffer, because the
executor binds only DRAW_FRAMEBUFFER. Its claim of unchanged frontier IDs was
invalid. The corrected probe explicitly binds and restores READ_FRAMEBUFFER for
each frontier read. Earlier integer-format reads also reported GL_INVALID_OPERATION.
Use the final corrected envelope probe for frontier evidence; the identical-order
control establishes output repeatability only.

## Investigation phases and progress

The original checklist below preserves the investigation sequence. Unchecked
exploratory alternatives were superseded by the measured facing and junction
corrections; they are not outstanding implementation obligations. Current closure
and review are recorded at the end.

### Follow-up: authored topology and lost facing eligibility

The canonical production archive export contains 51 cells in 31 rendering islands:
290 directed exterior crossings, 48 directed depth-continuous indoor crossings,
and four directed indoor topology boundaries. The latter connect `0x0D4A0124`
with `0x0D4A0125`/`0x0D4A0126`; their proof failure is
`source-cell-crosses-portal-plane`.

The observed competing destinations are already in different authored indoor
components. For example, `0x0D4A0120`/`0x0D4A0121` occupy one side of the
landblock-local render plane Z = -72, while `0x0D4A012C`/`0x0D4A012D` occupy
the other. Their islands are 22 and 24. Their published indoor neighbors do not
connect the two groups. Likewise, `0x0D4A0110`/`0x0D4A0111` are in island 16
and `0x0D4A011E`/`0x0D4A011F` are in island 21, on opposing sides of Z = -96.
There is no demonstrated redundant indoor link between these competing groups.

The competing exterior masks come from placed building geometry, not just the
EnvCell's own aperture. In the Z = -72 example, building index 22 uses GfxObj
`0x010034CA`; building index 24 uses `0x010034C6`. Their overlapping aperture
planes have opposed normals, and both crossings have accepted side `positive`.
Away from the plane, the camera therefore belongs on the accepted side of one
mask and the rejected side of the other. They are not equivalent masks into the
same destination that can simply be deduplicated.

The current app renderer loses this distinction:

1. `PortalScopeWindowCuller.#expand` uses `facesCamera` on the source aperture,
   except for actual near-volume straddles.
2. Its selected-crossing rebuild collects every crossing whose endpoints are
   selected and belong to different rendering domains. It does not preserve the
   facing decision from traversal.
3. GPU propagation disables face culling. The propagation fragment shader checks
   source domain, reciprocal return, incoming plane, and source opaque depth,
   but does not reject the candidate for being on the wrong camera side.

Consequently, reaching both groups by legitimate paths can reintroduce a
back-facing building mask. It then competes with a legitimate front-facing mask
on nearly the same plane. This is a narrower explanation than inherently needing
multiple destination IDs at every tied pixel.

Retail `PView::ClipPortals` passes the portal's authored side to `PView::GetClip`
(`acclient.c:441901-441909`). ACE's `CellPortal` decodes the authored side from
`PortalFlags.PortalSide` (`ACE/Source/ACE.DatLoader/Entity/CellPortal.cs`). The
diagnostic uses our existing CPU predicate; it does not invent a replacement side
convention. A complete retail near-plane compatibility audit remains outstanding.

The in-memory experiment removes expanded triangles rejected by that predicate
from the production GPU stream, retaining crossings marked as near-plane straddles.
It changes neither cell groups nor metadata IDs, and runs the same normal/reversed
order comparison used above:

| Yaw  | Removed triangles | Changed output pixels | Changed envelope texels | Changed frontier IDs | GL errors |
| ---- | ----------------: | --------------------: | ----------------------: | -------------------: | --------: |
| 90°  |               103 |                     0 |                       0 |                    0 |         0 |
| 130° |               215 |                     0 |                       0 |                    0 |         0 |
| 140° |               239 |                     0 |                       0 |                    0 |         0 |

This proves that eliminating back-facing candidates removes the captured order
instability. It does not establish final visual correctness, coverage at the exact
user pose, or correctness for every near-plane and non-Euclidean case. This
post-admission triangle filter also cannot restore cells already lost to the ID
cap: production eligibility must be decided before GPU resource admission.

No production edits were made. The earlier suggestion to widen arrival IDs first
is superseded by checking complete workloads with facing eligibility preserved.

A separate diagnostic CPU culler, using production capacities and the same input,
measures the complete workload before the production planner retreats. Filtering
its selected crossings with the existing source-aperture facing rule gives:

| Yaw  | Complete cells / domains | Original crossings | Eligible crossings | Required arrival states | Eligible triangle vertices |
| ---- | -----------------------: | -----------------: | -----------------: | ----------------------: | -------------------------: |
| 90°  |                  17 / 12 |                108 |                 54 |                      55 |                        309 |
| 130° |                  35 / 19 |                220 |                110 |                     111 |                        645 |
| 140° |                  38 / 21 |                246 |                123 |                     124 |                        717 |
| 145° |                  40 / 22 |                266 |                133 |                     134 |                        762 |
| 180° |                  37 / 20 |                256 |                128 |                     129 |                        732 |
| 220° |                  38 / 21 |                246 |                123 |                     124 |                        717 |

Every diagnostic CPU plan completes. These poses have no retained back-facing
near-plane exceptions; such exceptions remain part of the proposed contract but
were not exercised here. Eligible arrival counts fit the current 255-state limit,
and eligible triangle vertices fit the current 2,048-vertex stream. This establishes
that the ID-cap pressure in these poses is avoidable without widening the format.
At this workload-only stage, complete atlas packing and composition were not yet
tested. The verification below subsequently covers both. At that diagnostic stage, production remained unchanged:
its yaw 145° and 180° plans still report four and three retreats respectively.

Interpretation: the two independently reproduced rendering failures share a
plausible narrower cause in this area: the GPU candidate set has forgotten CPU
facing eligibility. Earlier independence meant that fighting reproduces without
capacity exhaustion, not that the two failures must require unrelated fixes.

### Verification before GPU admission

An in-memory adapter now applies the same eligibility rule to the culler's
selected crossing view before the production atlas planner counts resources.
It remaps crossing ordinals and reciprocal arrival IDs, and forwards frontier
rollback to the underlying frame before rebuilding its filtered view. This is
diagnostic code in `/tmp`, not a proposed production abstraction.

All six center poses complete with zero arrival, triangle-stream, or atlas-packing
retreats. The actual retained scope counts match the complete-workload table above;
yaw 145° retains 40 scopes instead of 2, and yaw 180° retains 37 instead of 35.
No exact-reference scope is lost. Normal versus reversed triangle order produces
zero output, envelope, and per-round frontier differences at all six poses, with
zero GL errors. The former post-admission triangle filter removes zero additional
triangles, confirming that eligibility was enforced before submission.

The failed first admission launch returned no usable evidence; the successful
retry is the basis for these claims. An initial near-plane probe subsequently
failed during texture fetches and timed out awaiting EnvCell publication, before
the experiment began. It is excluded from compatibility evidence.

Retail `PView::InitCell` explicitly computes the eye's signed distance to a portal
plane, uses the same approximately 0.0002 tolerance, and compares sidedness with
the authored portal side (`acclient.c:441282-441310`). This supports retaining the
existing CPU facing convention. Its incoming-portal handling and behavior inside
the tolerance band require preserving the established near-plane contract rather
than applying an unconditional facing rejection.

The successful near-plane retry loads only the target landblock: terrain,
buildings, explicit objects, generated objects, and EnvCells all have radius zero.
It samples 24 positions/orientations around two source apertures of `0x0D4A010F`
(crossings 82 and 84), using each aperture's vertex-average center, offsets of
0, 0.0001, and 0.025 along its accepted normal, and yaw 0°, 90°, 180°, and 270°.
The runtime containment query proves each tested position belongs to the root cell.

All 24 poses have zero GPU retreats, lost exact-reference scopes, GL errors, and
normal/reversed differences in output, envelope, or frontier IDs. Twelve poses
retain one or two near-plane exceptions that ordinary facing would reject. This
tests the exception, rather than merely testing positions close to a portal.
It is a local compatibility sample, not a global non-Euclidean-content proof.

### Proposed production correction

Keep the change in the app renderer's `PortalScopeWindowCuller`. The selected
GPU crossing set should contain only crossings that pass the source-aperture
camera-facing rule or have a retained near-plane-straddle route. Decide this
before arrival/triangle counting and atlas admission, not in the GPU shader or
by filtering an already-truncated draw stream.

Reuse the existing facing convention and near-plane facts at their owning culler
layer. Derive camera-dependent facts coherently for the current input; preserve
them when the selected set is refreshed or a frontier is rolled back. Both
selected-crossing enumeration branches must enforce the same predicate. Near-plane
facts must be available before filtering; today's post-selection flag pass cannot
simply be left in that order. Reciprocal arrival IDs must continue to resolve from
the final selected ordinals.

Do not port the temporary Proxy adapter into production. No host geometry,
render-domain grouping, public contract, shader, or resource-format change is
currently justified by these reproductions. Keep line growth localized and prefer
sharing the existing eligibility computation over parallel admission policies.

Before completing implementation, add meaningful synthetic coverage for the
reintroduced back-facing transition, retained near-plane exception, both selection
branches, and frontier rollback. Verify cross-landblock offsets and genuine
topology boundaries against the exact references, then repeat the six center poses
and 24 boundary poses through the real production code. User visual acceptance
and wider compatibility remain outstanding. Production edits are not yet authorized.

### Direction: test collapse before expanding compositor state

The user proposed aggressive interior portal collapse. Proven depth-continuous
interior seams already share rendering groups and do not consume GPU arrival
IDs. The corrected captures contain 108 exterior transitions and no indoor
boundaries at yaw 90°; 244 exterior transitions and two indoor topology boundaries
at yaw 140°. The observed competing masks are exterior transitions.

Further interior collapse alone therefore does not directly remove the observed
offenders. The next investigation prioritizes why their destination cells remain
separate, whether their authored relationships prove ordinary continuous space,
and whether equivalent exterior masks can be combined. Potential directions:

1. Merge rendering groups only where shared depth and visibility are justified.
2. Combine equivalent transition masks into the same destination group.
3. If distinct destinations must both contribute, represent that visibility
   explicitly rather than arbitrarily selecting a stable winner.
4. Size any remaining arrival-ID capacity requirement after safe simplification.

This was the investigation direction before the facing rule was proven. The
selected production correction restores that rule; additional merging remains
a conditional follow-up.

The authored-topology and facing experiment above now prioritize restoring the
existing eligibility contract. Additional collapsing and wider IDs are conditional
follow-ups, rather than the initial remedy for these reproduced masks.

### Phase 1: establish independent failures

- [x] Map host classification, CPU selection, GPU admission, and composition.
- [x] Reproduce capacity-related loss and identify the exhausted resource.
- [x] Reproduce order-dependent composition with zero retreats.
- [x] Validate output repeatability and corrected frontier readback.
- [x] Test the frontier depth-format substitution.

### Phase 2: establish the intended ownership contract

- [ ] Capture the first divergent pixel and competing triangles, including
      raster depths, accepted sides, source/target domains, reciprocal IDs, and planes.
- [ ] Determine why these nearly coincident masks have no junction identity:
      geometric non-overlap, oversized source-domain groups, or another classification.
- [ ] Compare authored portal records, placed aperture geometry, and relevant
      retail behavior. Establish whether one or multiple destinations must contribute.
- [ ] Freeze scene inputs and perturb yaw by small increments with zero retreats;
      correlate ownership changes with the reported jagged coverage.
- [ ] Build a minimal synthetic case from the proven geometry/ownership facts.
- [x] Inspect competing destinations' islands, indoor links, and opposed building
      aperture sides.
- [x] Identify the loss of camera-facing eligibility between traversal and GPU
      submission; verify that restoring it removes captured order dependence.
- [x] Verify complete atlas admission and composition with eligibility applied
      before resource counting, including the previously truncated poses.
- [ ] Exercise near-volume straddles, reciprocal transitions, and non-Euclidean
      boundaries against the existing exact references before selecting the cutover.
- [x] Verify 24 contained near-plane poses, including 12 poses with retained
      facing exceptions; no reference loss or GPU order differences.

Acceptance: an explicit visibility rule for the competing destinations, supported
by reference evidence and a deterministic reproducer. Reassess scope here before
selecting a production change.

### Phase 3: size and propose the fixes

- [ ] Measure complete CPU-planned arrival, triangle, domain, and atlas workloads
      with a diagnostic planner, without submitting IDs beyond the GPU format.
- [x] Measure complete CPU workloads and facing-eligible arrival/triangle counts
      at six orientations; verify complete atlas admission at all six.
- [ ] Evaluate capacity/layout changes against WebGL2 guarantees and memory cost.
- [ ] Evaluate ownership changes against the Phase 2 contract. Prefer collapsing
      proven equivalent masks before adding state or special cases.
- [ ] Size affected content and expected production code impact.
- [x] Present the concrete proposed changes, trade-offs, and validation criteria.

An arbitrary stable tie-break might hide the flicker while choosing the wrong
room. More arrival IDs solve capacity loss but do not solve ownership. Keep the
two acceptance criteria independent.

### Phase 4: implementation and cleanup, after authorization

- [x] Implement the selected contracts at their owning layers.
- [x] Add lightweight synthetic tests for the actual failure modes; no permanent
      tests requiring untracked DAT assets.
- [x] Verify complete visibility and ownership on the captured poses and controls.
- [ ] Preserve non-Euclidean boundaries, reciprocal suppression, near-plane
      straddles, and retail geometry protruding through entry planes.
- [x] Run relevant formatting, lint/type checks, tests, and browser diagnostics.
- [x] Keep diagnostic paths outside production; review the final diff and document limits.
- [x] Leave visual acceptance to the user unless explicitly requested.

## Production implementation and validation

The renderer-owned `PortalScopeWindowCuller` now rejects GPU crossings whose
source aperture does not face the camera, unless retained traversal work reached
them through a near-plane straddle. Both sparse adjacency enumeration and dense
crossing enumeration apply this rule before GPU resource admission. Source-plane
classification uses the existing authored side, query epsilon, and source
landblock offset; it does not substitute the visibility aperture's plane.

Each crossing's facing decision is computed at most once per frame and stored in
one byte of fixed arena storage. Traversal and selection reuse that decision;
synchronous capacity retreats use cached decisions without retaining camera
inputs. Near-plane exceptions are rebuilt from retained work before selection,
so removing a frontier also removes its exceptions. Stable crossing order,
reciprocal arrival-ID mapping, and same-island GPU seam exclusion remain intact.
The facing-test metric now counts classified crossings rather than repeated route
tests. No shader, host classification, render-island, or GPU-capacity change was
needed.

Durable synthetic regression coverage exercises both selection paths, independently
reached rooms connected by a back-facing crossing, camera changes between frames,
different source and visibility planes, both authored accepted sides, source
landblock offsets, and a retained back-facing straddle removed by frontier retreat.
The existing seeded differential corpus continues to check conservative visibility,
including cycles, multipart apertures, footprint thresholds, and cross-landblock
cases. Its crossing assertions now require the corrected eligibility contract.

Validation through production code, with the experimental culler adapter and
post-admission triangle filter removed:

- Six captured problem orientations (90°, 130°, 140°, 145°, 180°, 220°): zero GPU
  retreats, zero lost exact-reference scopes, zero WebGL errors, and zero normal
  versus reversed-mask-order differences in color, envelope depth, and frontier IDs.
  Yaw 145° retains 40 cells instead of 2; yaw 180° retains 37 instead of 35.
- All 24 contained near-plane poses: zero retreats, lost reference scopes, WebGL
  errors, or color/envelope/frontier order differences.
- The original 244-pose survey: all CPU views complete, zero lost reference scopes,
  zero GPU retreats, and zero truncated rendered views. Before the correction,
  23 poses lost reference scopes and retreated.
- Full frontend suite: 340 files and 2,769 tests passed. `npm run check` passed
  with zero Svelte errors/warnings; `npm run lint:ts`, focused Prettier checks,
  and `git diff --check` passed. No Rust code changed.

The first production order-probe attempt failed while loading the browser app's
initial dynamic module, before any experiment ran. A fresh run loaded successfully
and supplied the six-pose results above; the failed attempt is not rendering evidence.

The production diff is limited to the culler, its synthetic differential tests,
and this investigation doc. Diagnostic drivers remain outside the repository.
At this stage, visual acceptance of the original reported area remained pending;
no claim of universal portal correctness is made.

## Follow-up: immediate neighbors replaced by outdoor scenes

The user accepted the reduction in z-fighting, then reported that from
`0x0D4A011D` toward `0x0D4A012D` the immediate neighbor is replaced by outdoor
content, while farther cells appear. Moving into the neighbor reverses the problem.
The user requested probes; this diagnosis initially made no further production changes.

These cells have no direct authored indoor link. Their adjacency passes through
`room → outdoor → room` on a shared aperture plane at landblock-local Z = -96.
Production probes at both cell centers and four cardinal orientations reproduce
CPU selection of the neighbor with no GPU arrival for that neighbor. Farther
cells receive GPU arrivals. There are zero capacity retreats or WebGL errors.

The concrete forward pair is crossing 199 (`011D → outdoor`) followed by 339
(`outdoor → 012D`). The reverse pair is 338 then 200. Neither pair has a junction
identity. The GPU propagation fragment shader rejects a candidate on the incoming
entry plane unless both crossings share a nonzero junction identity. Thus it stops
in the outdoor domain, while farther portals pass the positive-depth test.

Controlled numeric experiment: copy the GPU metadata and assign a shared temporary
junction identity to just the tested pair, without changing geometry, facing,
selection, shaders, or capacities. From `011D` center `[2604, 23.6, -14316]`, yaw
180°, the neighbor goes from zero GPU arrival pixels to 128,616. From `012D` center
`[2604, 23.6, -14292]`, yaw 0°, the reverse neighbor likewise goes from zero to
128,616. Final diagnostic color changes at 119,822 and 97,461 pixels respectively;
WebGL errors remain zero. These are arrival/readback measurements, not visual
acceptance or a production fix. Cameras were checked against cell containment.

The missing junction identity is explained by the existing host proof. A temporary
Rust driver calls the production `resolve_junction_groups` and
`apertures_form_junction` on the canonical exported geometry. Crossings 199 and 339
pass the overlap predicate. Their connected component is
`[199, 200, 294, 295, 318, 319, 338, 339]`; outdoor contributes four members, so the
host declines the entire component under its two-members-per-source-domain bound.

Those four outdoor entries are one tall aperture into `011D` and three vertically
partitioned apertures into `0129`, `012D`, and `012B`:

- `0129`: Y = 18.2 to 19.
- `012D`: Y = 19 to 28.2.
- `012B`: Y = 28.2 to 29.
- `011D`: Y = 18.2 to 29, overlapping the three pieces.

All three destination pieces belong to rendering island 24. Their pairwise
interior overlap tests are false under the production junction predicate. The
component-wide member count therefore overcounts alternatives at an individual
pixel: it sees four records even though the three destination pieces have disjoint
interiors. This explains both the host rejection and the immediate-neighbor pattern.
It also answers one previously open question about missing junction identities.

Next direction: refine the host's junction soundness proof around overlapping
footprints, preserving the bound on simultaneous equal-depth candidates after
reciprocal suppression. A connected component's total member count is too coarse
for these partitioned apertures. Do not merely raise the global limit or disable
the GPU entry-plane check: genuinely overlapping destinations and equal-depth
cycles still require rejection or an explicitly supported visibility contract.
Synthetic coverage should distinguish this tall-aperture/partitioned-neighbor
case from ambiguous overlapping candidates, then verify both directions through
production GPU code and repeat order/capacity controls.

Artifacts: `/tmp/h3d-portal-neighbor-order.json` (eight production poses),
`/tmp/h3d-portal-neighbor-junction-order.json` (two pair-only metadata experiments),
and `/tmp/h3d-neighbor-junction-census.rs` (temporary driver using production host
predicates). Drivers and output remain outside the repository.

## Implemented host junction proof

The user authorized implementation after the problem-solving reassessment. The
host's existing coplanar-overlap pass now retains same-source-domain overlap
edges. A junction component is declined if that graph contains three mutually
connected exits. This catches every possible three-way interior overlap while
allowing a tall opening to connect disjoint pieces. The previous global count of
component members no longer decides safety.

This preserves the per-interior-point limit of two exits and the existing reciprocal
suppression contract. Pure reciprocal pairs and singletons still receive no ID;
ambiguous groups still use strict entry-plane rejection. The pairwise rule is
conservative: three pairwise overlaps with no common triple intersection are also
declined. Following final review, any positive interior overlap counts toward
ambiguity, even below the existing component-formation area threshold. Zero-area
boundary contact still does not compete. The change adds no polygon splitting, shader branch, render-island
merging, or capacity increase. Runtime shader and planner comments now describe
the per-point proof rather than the obsolete component-wide count.

The declined-group diagnostic now reports an `AmbiguousJunction` with the concrete
three conflicting crossing indices, rather than an `OversizedJunction` and a raw
member count. Those facts come from the host proof and are consumed by the host's
warning; downstream rendering continues to consume only the assigned junction ID.
Stored overlap edges reuse geometry results from the existing pairwise pass, so
no geometry predicate is repeated by the new ambiguity check. Allocation is
limited to static content preparation, not camera-time rendering.

Synthetic host tests cover a tall aperture and three disjoint reciprocal pieces,
overlapped pieces that must decline the whole component, three ambiguous exits,
and the conservative pairwise-without-triple case. Existing reciprocal/singleton
and separate-footprint tests remain. All host library tests passed before the last
new regression case; the final 14-test portal-visibility suite also passed, as did
host clippy with warnings denied. The 44 focused frontend tests passed, including
seeded cycles, reciprocal/junction behavior, and planner capacities. TypeScript
lint, focused formatting, Rust formatting, and whitespace checks passed.

The full local crossing census compares canonical exports before and after the
host change: all 342 crossings in landblock `0x0D4AFFFF` retain their identity and
geometry. Junction groups increase from 31 to 55: 24 newly accepted groups cover
176 previously unassigned crossings. No previously assigned crossing loses its
junction. This census covers the reported landblock, not the entire shipped archive.

Production GPU verification uses the real host output without the pair-only
metadata override:

- Eight cardinal views from both room centers have zero lost reference rooms,
  retreats, WebGL errors, or reversed-mask-order color/envelope/frontier differences.
- From `011D` toward `012D` at yaw 180°, neighbor arrival coverage is now 128,616
  pixels instead of zero. From `012D` toward `011D` at yaw 0°, it is 150,984 instead
  of zero. The reverse coverage exceeds the pair-only experiment because other
  safe junctions are now admitted too. Views facing away correctly do not reach
  the neighbor.
- The 244-pose survey still has all views complete, zero lost exact-reference scopes,
  zero retreats/truncated views, and no browser console messages.
- All 24 contained near-plane poses still have zero lost scopes, retreats, WebGL
  errors, or mask-order differences in color, envelope, and frontier IDs.

One near-plane probe attempt failed during the browser's initial app-module fetch,
before experimentation. A fresh run succeeded and supplied the results above.

Final diff review found the change confined to host junction preparation and its
synthetic tests, with related diagnostic vocabulary and renderer proof comments
updated together. The earlier camera-facing correction remains intact. No shared
world policy, retail decompile, or ACE files were changed, and no commit was made.
The user subsequently accepted the adjoining-room correction and requested closure.

Additional session artifacts:
`/tmp/h3d-0d4a-junction-fixed-archive.json`,
`/tmp/h3d-0d4a-junction-fixed-manifest.json`,
`/tmp/h3d-portal-neighbor-fixed-order.json`,
`/tmp/h3d-0d4a-junction-fixed-survey.json`, and
`/tmp/h3d-portal-junction-fixed-near-order.json`. The neighbor driver writes its
latest run to `/tmp/h3d-portal-neighbor-order.json`; the fixed copy preserves this
production result separately from earlier diagnostic descriptions.

## Open questions and completion criteria

The user has accepted the local corrections. Remaining broader compatibility
investigations below are follow-ups, not prerequisites to this completed local fix.

The missing junction identities for the reported adjoining-room passage are now
explained and corrected. Unresolved: the exact original screenshot camera pose;
broader content compatibility; and whether any genuinely eligible workload still exceeds
the current GPU capacities. Correct ownership in a view with legitimately tied,
front-facing destinations remains an open case, rather than a prerequisite to
eliminating the back-facing offenders already identified.

No permitted loss of visible rooms has been established. Any retained bounded
fallback or rendering concession must be explicit and supported by evidence.

Completion requires a justified visibility contract, no capacity loss on the
reproductions, order-independent composition consistent with that contract,
appropriate regression coverage, required checks passing, and user visual
acceptance of the original area. Diagnosing these failures is not completion of
the rendering fix.

## Local evidence

These `/tmp` files are session artifacts, not durable prerequisites. Essential
facts are recorded above; preserve or regenerate artifacts if needed later.

- `/tmp/h3d-0d4a-portal-survey.json`: 244 poses and exact-reference scope checks.
- `/tmp/h3d-0d4a-planner-trace.json`: exact capacity-retreat cause at yaw 145°.
- `/tmp/h3d-0d4a-yaw145.json`: separate stationary capacity reproduction.
- `/tmp/h3d-portal-envelope-order.json`: corrected frontier, envelope, and color
  order comparisons; `/tmp/h3d-portal-envelope-probe.mjs` reproduces them.
- `/tmp/h3d-portal-depth-control.json`: identical-order output controls;
  `/tmp/h3d-portal-depth-control.mjs` reproduces them. Frontier readings in this
  older control use the superseded readback and are not ownership evidence.
- `/tmp/h3d-portal-precision-order.json`: temporary 32-bit float attachment
  experiment; `/tmp/h3d-portal-precision-probe.mjs` reproduces it.
- `/tmp/h3d-0d4a-archive.json`: canonical production source export;
  `/tmp/h3d-0d4a-manifest.json` and `/tmp/h3d-0d4a-topology.json` expose cell
  arrays, classifications, and selected placed aperture geometry.
- `/tmp/h3d-0d4a-topology.mjs`: section-based extraction from that export.
- `/tmp/h3d-portal-facing-order.json`: GPU order comparison after diagnostic
  removal of back-facing triangles; `/tmp/h3d-portal-facing-probe.mjs` reproduces it.
- `/tmp/h3d-portal-facing-workload.json`: independent complete CPU workloads and
  eligible counts; `/tmp/h3d-portal-facing-workload.mjs` reproduces them.
- `/tmp/h3d-portal-admission-order.json`: complete pre-admission correction and GPU
  order checks; `/tmp/h3d-portal-admission-probe.mjs` reproduces them.
- `/tmp/h3d-portal-near-admission-order.json`: 24 contained portal-boundary poses;
  `/tmp/h3d-portal-near-admission-probe.mjs` reproduces them.

- `/tmp/h3d-portal-production-admission-order.json`: production six-pose order checks;
  `/tmp/h3d-portal-production-admission-probe.mjs` reproduces them.
- `/tmp/h3d-portal-production-near-admission-order.json`: production 24 near-plane
  order checks; `/tmp/h3d-portal-production-near-admission-probe.mjs` reproduces them.
- `/tmp/h3d-0d4a-production-portal-survey.json`: production 244-pose survey.

## Final code-quality review and closure

Review boundary: the accumulated host junction correction, renderer facing
correction, synthetic tests, related comments, and this investigation document,
against commit `4dbf81a0`. The existing dirty ACE submodule is unrelated and excluded.

Contract/seam coverage:

- Host `resolve_junction_groups` → `env_cell_source` serialization: proof-owned
  identities and concrete rejection witnesses; geometry is unchanged.
- HBEC decoder → EnvCell realization/landblock-qualified junction identity →
  scene graph crossing copy: accepted side, source versus visibility apertures,
  reciprocal identity, and junction identity remain distinct and preserved.
- Culler traversal → selected frame → atlas planner/triangle stream → GPU metadata:
  eligibility is owned by the culler; consumers use the prepared crossing set.
  Near-plane exceptions follow retained routes, including synchronous retreat.
- Frame reset/topology replacement → facing cache and selected crossing markers:
  the culler owns invalidation; retreats classify no new camera facts.
- GPU routing → propagation/resolve: zero remains the absent-junction sentinel;
  reciprocal suppression and entry-plane tests consume the prepared metadata.

Confirmed review finding, fixed before commit: the ambiguity graph originally
reused the minimum-area component threshold and could miss a small positive
overlap between competing pieces. One overlap-area computation now feeds both
decisions: components require the existing area threshold; ambiguity retains
any positive overlap within that component. Added tests prove small competing
interiors are declined while subthreshold contact outside the component does not
change its identity. The public overlap predicate's comment now distinguishes
geometric connectivity from the complete junction safety proof.

Bounded verdict: no remaining blockers in the reviewed diff. The fixed-size
camera-facing cache has one owner and a documented reset/retreat lifetime. The
static overlap graph replaces a coarse count without introducing a runtime
policy layer. The added code is justified by the two visibility rules and their
synthetic regression cases; all disposable diagnostics remain outside the repo.
Accepted trade-offs are conservative rejection of pairwise-only overlaps and
extra graph storage during content preparation. No measured performance gain is
claimed. A complete shipped-archive census and unrelated world/network lifecycle
paths were not reviewed; local production probes provide the integration evidence.

Final validation: 354 host library tests and 2,769 frontend tests passed; host
clippy with warnings denied, frontend checks (zero Svelte errors/warnings),
TypeScript lint, and relevant formatting/whitespace checks passed. Final reviewed
production probe results are recorded below before commit.

Reviewed production reruns passed: all eight adjoining-room views and 24
contained near-plane views have zero lost scopes, capacity retreats, WebGL errors,
or color/envelope/frontier differences under mask-order reversal. The 244-pose
survey has zero lost scopes, incomplete CPU views, retreats/truncated views, or
browser console messages. Repeated initial app-module fetch failures happened
before measurements; an isolated survey run succeeded. The reviewed canonical
export still has 55 junction groups (31 before this work), with the same 176 newly
assigned crossings and unchanged geometry.

The user has accepted the fixes. Review and validation are complete; no required
implementation work remains. This document is closed working history. Broader
archive compatibility and genuinely ambiguous eligible workloads remain future
investigations, rather than claims made by this change.
