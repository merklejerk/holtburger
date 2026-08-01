# Holtburger 3D Static-Authored Animation Runtime Plan

Status: Ready for phased implementation
Created: 2026-07-31
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`

## Context and Boundaries

### Goal

Render setup-backed static-authored residents with faithful default rigid-part animation, visual
hooks, shared prepared resources, conservative bounds, and frame-streamed GPU instancing while
preserving authored placement, residency, and source ownership.

### Why This Plan Comes First

Static-authored dynamics are already present in loaded landblocks and environment cells. They offer
a real, numerous, content-backed workload without first requiring server entity state, motion-table
resolution, clock synchronization, or a spawned-entity host. Completing this slice produces visible
world fidelity and establishes the frontend visual/runtime bones later plans will reuse.

The current app already classifies setup-backed residents with default animation as dynamic, but it
defers them instead of rendering them. `DynamicEntitySystem` prepares each entity independently,
`AnimationSystem` only applies already-sampled poses, and the renderer counts visible dynamic
entities without submitting their geometry. This plan closes that complete authored path.

### In Scope

- Lossless classification of setup default animation and default physics-script capabilities.
- Promotion and owner-safe lifetime of static-authored residents with default animation.
- Shared, appearance-aware object visual templates and prepared animation assets.
- Complete rigid-part geometry/material partitions and frame-streamed instanced submission.
- Per-entity setup-default playback, fractional visual interpolation, and deterministic semantic
  frame/hook advancement.
- Visual-root hook behavior required by shipped setup-default animations, including `SetOmega`.
- Explicit composition of authored root placement, visual-root modifiers, rigid-part pose, and
  scale.
- Conservative bounds spanning prepared animation poses and unbounded visual-root rotation.
- Outdoor and environment-cell authored residents, diagnostics, representative workload
  measurement, and cleanup.
- Preservation of script IDs and explicit deferral of script execution for the next roadmap plan.

### Out of Scope

- Spawned/server entities, `DynamicEntityFeed`, `ExplorerRuntime`, or world-to-frontend entity
  projection.
- Motion tables, `MotionCatalog`, `MotionResolver`, semantic movement commands, or motion plans.
- Sparse placement anchors, correction/reconciliation, teleport, or motion-derived portal traversal.
- Applying animation position frames to static authored scene placement. Retail advances static
  default animation without requesting root-offset output; authored placement/residency remains the
  authority in this plan.
- Physics-script and script-table execution, particles, sound, lighting, or chained scripts. Those
  belong to the static-authored effects plan.
- Animation-time `ReplaceObjectHook` execution. Appearance-time `ObjDesc.anim_part_changes` remain
  part of effective visual-template preparation; timed part replacement belongs to the
  static-authored effects plan.
- Entity-to-entity attachment mutation and animated parent-part following. Preserve existing source
  facts and defer the shared runtime behavior to the spawned-entity plan, where it has a concrete
  lifecycle consumer.
- Focused runtime appearance mutation or complete server-generation replacement.
- Weighted skeletal skinning, GPU-driven culling, indirect drawing, or speculative pose caching.

## Ground Truth and Existing Precedent

### Authoritative References

- `acclient-eor-source/acclient.c`
  - `CPartArray::Draw` and `CPhysicsPart::Draw`: rigid parts render independently.
  - `CPartArray::UpdateParts`: object frame, sampled part frame, and scale compose final part
    transforms.
  - `CSequence::get_curr_animframe`: retail chooses the semantic frame using
    `floor(frame_number)`.
  - `CPhysicsObj::InitDefaults`: a static object becomes behavior-active when its setup has a
    default animation or default physics script.
  - `CPhysicsObj::animate_static_object`: default animation advances without root-offset output;
    `SetOmega`-style rotation is applied explicitly to object-frame behavior.
- `ACE/Source/ACE.DatLoader/FileTypes/Animation.cs` and
  `ACE/Source/ACE.DatLoader/Entity/AnimationFrame.cs`: one transform per setup part plus hooks.
- `ACE/Source/ACE.DatLoader/Entity/AnimationHooks/ReplaceObjectHook.cs`: part-local replacement
  shape, retained losslessly for the static-authored effects plan; the representative animation
  workload does not exercise it.
- `ACViewer/ACViewer/Physics/PartArray.cs:293-304`: setup default animation installs as a looping
  sequence.
- `ACViewer/ACViewer/Physics/PhysicsObj.cs:680-710`: setup defaults initialize animation and scripts;
  animated/scripted static objects enter behavior updating.

### Existing Code to Extend

- `apps/holtburger-3d/src/lib/game/resolution/object-resident-classifier.ts`
- `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-system.ts`
- `apps/holtburger-3d/src/lib/game/systems/animation-system.ts`
- `apps/holtburger-3d/src/lib/game/geometry/geometry-manager.ts`
- `apps/holtburger-3d/src/lib/game/textures/atlas/resident-texture-atlas.ts`
- `apps/holtburger-3d/src/lib/game/renderer/frame-instance-stream-arena.ts`
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
- `crates/holtburger-content/src/material_graph.rs`
- `crates/holtburger-core/src/content_assets.rs`

### Measured Workload

The recorded radius-one scans around `0xDA55FFFF` and `0xDC58FFFF` contain 44 and 162 default-animation
owners respectively. The exact representative setups are:

| Setup        | Animation    | DA55 | DC58 | Frames / parts | Slots per part | Material | Required hook |
| ------------ | ------------ | ---: | ---: | -------------- | -------------: | -------- | ------------- |
| `0x02000493` | `0x030006CB` |   22 |   77 | 90 / 2         |              1 | cutout   | `SetOmega`    |
| `0x02000494` | `0x030006CA` |   19 |   82 | 90 / 2         |              1 | cutout   | `SetOmega`    |
| `0x020005AC` | `0x03000751` |    3 |    3 | 7 / 2          |              1 | opaque   | `SetOmega`    |

The butterfly setups share their GfxObj, surface, texture, and render surface while retaining
different setup/template and animation identities. Their authored setup spheres have radius zero,
but vertex sweeps require non-zero conservative bounds. All three representative clips have no
position frames and one frame-zero `SetOmega` hook. A production archive scan found only two setup
default clips with position-frame arrays; those translations are also zero.

A focused 2026-08-01 dependency probe confirmed that each setup contains two copies of one GfxObj,
each GfxObj has one material slot, and none of the setups has holding locations, useful authored
spheres, default scale, or another default behavior resource. The two cutout butterflies share
GfxObj `0x01003D53`, surface `0x0800128C`, texture `0x05002C29`, and render surface `0x06006270`.
Setup `0x020005AC` uses GfxObj `0x010016E0`, surface `0x08000010`, texture `0x050016F6`, and render
surfaces `0x0600379C`/`0x0600379D`. These assets prove shared part-resource identity, but not
multi-material partitioning, runtime part replacement, or attachments.

Before hook execution lands, inspect a small representative set of setup-default animations that
covers the hooks and playback boundaries exercised by this plan. This is an evidence sample, not an
exhaustive DAT census. Effect-producing hooks found in those examples remain recorded for the next
plan rather than silently executed or allowed to widen this plan mid-phase.

### Recorded Playback and Hook Evidence

The retail sequence path fixes the semantic traversal contract:

- `CPartArray::InitDefaults` installs the setup default animation as a cyclic sequence spanning the
  complete clip at 30 Hz.
- `CSequence::update_internal` computes the previous semantic frame with `floor(frame_number)`,
  advances continuous frame time, and walks departed frame indices under the boundary rules below.
- Forward traversal dispatches hooks from each frame being departed with direction `Forward`;
  reverse traversal does the same with direction `Backward`. `CSequence::execute_hooks` accepts
  hooks authored for that direction or `Both` and preserves their authored list order.
- Retail clamps to the terminal frame before boundary traversal, so forward traversal does not
  dispatch the high-frame hook at the forward seam and reverse traversal does not dispatch the
  low-frame hook at the reverse seam. Hooks on the next cyclic starting frame dispatch when that
  frame is subsequently departed.
- Crossing a sequence boundary carries the remaining elapsed time into the next animation or first
  cyclic animation. Implement this iteratively even though ACE's readable translation expresses the
  continuation recursively.
- `CPhysicsObj::process_hooks` executes the queued animation hooks in insertion order after static
  animation pose, object omega, part, and child updates, then clears the queue.
- `CPhysicsObj::animate_static_object` treats an elapsed gap above two seconds as a discontinuity:
  it rebases update time without advancing animation or dispatching missed hooks.
- `SetOmegaHook::Execute` replaces the object's persistent omega vector. Static-object updates apply
  that vector to the object frame once per accepted static-animation update; the hook queued during
  an update affects subsequent updates.

ACE's `Sequence.update_internal`, `Sequence.execute_hooks`, and `PhysicsObj.process_hooks` corroborate
the decompiled control flow. A focused 2026-08-01 probe of the three representative archive clips
recorded no position frames and exactly one direction-`Both` frame-zero `SetOmega` hook per clip:

| Animation    | Frames / parts | Hook omega `(x, y, z)`             |
| ------------ | -------------- | ---------------------------------- |
| `0x030006CB` | 90 / 2         | `(0, 9.1724917e-10, -0.026797784)` |
| `0x030006CA` | 90 / 2         | `(0, 9.1724917e-10, -0.026797784)` |
| `0x03000751` | 7 / 2          | `(0, 1.3142817e-9, -0.03839724)`   |

The app intentionally chooses deterministic independent starting phases rather than reproducing a
retail shared-phase policy. Activation must therefore fold persistent visual hooks crossed between
clip start and the selected phase into initial visual state without emitting transient or deferred
effect hooks. For the representative clips, this means a resident starting after frame zero begins
with the authored omega already installed.

## North Stars

1. Optimize for faithful authored-world presentation before spawned-entity generality.
2. Authored source ownership controls lifetime; authored placement and residency remain fixed in
   this plan.
3. Expensive visual and animation preparation is keyed by immutable content identity, never entity
   identity.
4. Per-entity state contains only mutable playback, visual contribution, and resource-handle state;
   each resident owns an independent, deterministic playback phase.
5. Semantic frame/hook advancement is distinct from fractional render-time pose interpolation.
6. Animation produces pose and hook contributions; it does not mutate scene nodes or GPU resources.
7. Pose composition is explicit: authored root, visual-root modifier, rigid-part pose, and scale.
8. Instancing is the default rigid-part submission path, including the first working implementation.
9. Unsupported authored behavior is attributable and deferred, never silently discarded.
10. Do not add feed, motion, or simulation abstractions without a consumer in this plan.

## Target Runtime Shape

```text
authored outdoor/env-cell resident
  -> setup-default behavior classification
  -> resolved authored dynamic source
  -> shared ObjectVisualTemplate + PreparedAnimation
  -> per-entity setup-default playback
  -> rigid-part pose + visual hooks
  -> explicit authored-root pose composition
  -> visible part contributions
  -> frame-streamed compatible instance cohorts
  -> WebGL object passes
```

The authored root remains the scene placement and residency authority. Animation position data is
retained losslessly in prepared animation resources for later consumers, but setup-default static
playback does not apply it to the authored root. `SetOmega` and other proven visual modifiers act
below that root and therefore do not invent runtime movement or residency ownership.

## Phased Implementation

### Phase 1: Close the Authored Dynamic Source Contract

#### Deliverables

- Replace the alias-only dynamic commit with an authored dynamic source carrying setup identity,
  effective appearance, scale, placement, default animation ID, default script/table IDs, and
  behavior classification.
- Classify animation-only, script-only, combined, and neither without collapsing capability into one
  boolean.
- Make one authored layer installation an owner-atomic set so multiple promoted residents cannot
  evict one another.
- Remove the unused spawned commit-pipeline variant; landblock commits remain authored content work.
- Preserve script-only residents as working static presentation and retain their behavior facts for
  the effects plan.
- Add generation-safe staging so an evicted/replaced authored owner cannot publish late resources.

#### Acceptance Criteria

- One owner installs and removes multiple promoted animation residents atomically.
- Animation-only and combined residents enter animation staging; script-only residents retain their
  static presentation.
- Source contracts contain IDs and resolved selection facts, never decoded behavior payloads.
- No spawned-entity mutation path remains in the landblock commit pipeline.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 2: Prepare Shared Visual Templates

#### Deliverables

- Add canonical appearance-aware `ObjectVisualTemplateKey` and `PartVisualTemplateKey` types.
- Add an injected template preparer producing complete part geometry, material partitions, texture
  facts, setup transforms, and base bounds.
- Add a lease-owning template manager with shared in-flight preparation and explicit
  preparing/ready/failed states.
- Reuse `GeometryManager` and `ResidentTextureAtlas` as physical resource authorities.
- Apply effective appearance during preparation while keeping entity scale out of template identity.

#### Acceptance Criteria

- Many identical residents perform one CPU preparation and share physical geometry/material/texture
  resources.
- Different effective appearances do not alias.
- Owner eviction during preparation cannot publish stale templates or leak leases.
- Complete material partitions replace the current first-material-only behavior.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 3: Submit Dynamic Parts Through Frame-Streamed Instancing

#### Deliverables

- Generalize static-only instance-record and frame-arena vocabulary where the mechanism is genuinely
  shared.
- Produce renderer-neutral visible rigid-part contributions with batch identity, draw partition,
  render domain, composed transform, and per-instance modifiers.
- Group opaque/cutout parts by complete compatibility and form transparent instance runs only after
  global ordering.
- Add diagnostics for visible entities/parts, frame uploads, cohorts, draws, and instances.
- Prove submission with focused renderer fixtures until Phase 5 can satisfy the complete production
  activation gate; do not temporarily activate partially staged authored residents.

#### Acceptance Criteria

- Numerous identical two-part butterflies submit draws per compatible part/material cohort rather
  than per entity.
- Transparent ordering and portal/render-domain boundaries remain correct.
- The renderer no longer counts and discards visible dynamic geometry.
- No temporary per-entity draw path survives.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 4: Prepare Shared Animation Resources and Bounds

#### Deliverables

- Add compact typed Tauri animation transfer backed by `ContentAssetRequest::Animation`.
- Add `AnimationAssetRepository` with shared in-flight preparation, explicit failure, acquired
  handles, and deterministic release.
- Prepare flat part frames, position frames, frame timing, and normalized typed hooks without
  starting playback.
- Inspect representative setup-default animations and classify each encountered hook as
  visual-in-plan, later-plan-deferred, or unsupported-with-evidence.
- Define activation disposition by hook class: supported visual hooks activate; deferred
  non-structural effects remain observable while visual playback continues; deferred structural
  visual hooks such as `ReplaceObject` and unclassified visual hooks retain static presentation.
- Compute conservative local bounds across every prepared part frame, resolved appearance, setup
  scale, and unbounded visual-root rotation.

#### Acceptance Criteria

- Repeated residents referencing one animation perform one transfer/preparation.
- Frame-time sampling performs no I/O, DAT decoding, or dependency discovery.
- Butterfly bounds exceed their radius-zero setup spheres and remain valid through wing motion and
  continuous omega rotation.
- Every hook in the representative evidence set has an explicit disposition with source/frame
  provenance.

#### Decisions and Course Corrections

- 2026-08-01 evidence scope: representative animation examples replace an exhaustive archive hook
  census. The prepared format remains lossless for hooks outside the sample.
- 2026-08-01 scope cut: appearance-time `ObjDesc.anim_part_changes` remain template input;
  animation-time `ReplaceObjectHook` execution and its replacement-aware bounds move to the effects
  plan.

### Phase 5: Execute Static Default Animation and Visual Hooks

#### Deliverables

- Implement pure semantic frame selection, looping, direction, crossed-frame detection, and
  fractional part-pose interpolation.
- Add per-entity setup-default playback with an independent deterministic phase derived from stable
  authored resident identity; shared animation resources never imply shared playback clocks.
- Add a deterministic `HookSystem` and implement the visual hooks required by the representative
  evidence set, including persistent replacement-style `SetOmega` visual-root state.
- Traverse semantic hooks using retail's departed-frame, direction-filtered ordering and carry
  accepted leftover time across cyclic seams without recursion.
- Treat elapsed gaps above two seconds as discontinuities: retain playback and persistent hook state,
  rebase the entity clock, and dispatch no missed hooks.
- Fold persistent visual hooks crossed before an identity-derived initial phase into activation
  state without emitting transient or deferred effect hooks.
- Advance `SetOmega` on a deterministic 30 Hz authored-behavior clock and interpolate committed
  visual-root orientations for rendering; never apply the raw omega payload once per render frame.
- Add `PoseSystem` to compose authored root, visual-root modifiers, rigid-part pose, and scale once,
  then publish final part transforms for visibility and rendering.
- Evaluate visual pose and publish final transforms once per rendered frame. Tune that cadence only
  from side-by-side visual evidence and a measured pose/propagation bottleneck.
- Keep animation position frames prepared but unused by static default playback, matching retail's
  null root-offset path.
- Activate animation residents only after template, animation, hook, and conservative-bound staging
  completes.

#### Acceptance Criteria

- Representative authored butterflies animate in place with reproducible, independently phased
  playback and correct continuous visual-root rotation.
- A 30 Hz clip renders smoothly above its authored sample rate without changing semantic frame or
  hook behavior.
- Accepted updates visit each retail-selected departed semantic frame exactly once; gaps above two
  seconds visit none and resume without a catch-up burst.
- Starting after frame zero installs the representative persistent `SetOmega` state before first
  presentation without dispatching transient hooks.
- `AnimationSystem` does not mutate scene nodes, authored placement, residency, resources, or
  renderer state.
- `PoseSystem` does not own playback clocks or resource preparation.
- Visual sampling and final transform publication run at render cadence in the initial
  implementation without visible stepping above the authored sample rate.
- Script/effect hooks deferred to the next plan are observable with provenance and do not disappear.
- An unclassified visual hook keeps the resident in valid static presentation with source/frame
  provenance; it never silently activates partial visual behavior.

#### Decisions and Course Corrections

- 2026-08-01 product decision: authored residents use reproducible independent phases derived from
  stable resident identity rather than shared or nondeterministic clocks.
- 2026-08-01 retail evidence: hooks dispatch from departed frames in authored order with direction
  filtering and iterative leftover-time traversal. Gaps above two seconds dispatch nothing. The
  frontend preserves those semantics while smoothing visual pose and omega above the authored 30 Hz
  behavior cadence.
- 2026-08-01 scope cut: final part transforms remain a clean output of pose composition, but
  entity-to-entity attachment resolution and animated parent-part following move to the spawned plan.
- 2026-08-01 cadence policy: evaluate visual pose and final transforms at render cadence first;
  consider tuning only with side-by-side visual evidence and profiling that identifies this path as
  material.

### Phase 6: Resteer on the Real Authored Workload

#### Task Checklist

- [ ] Exercise the exact DA55/DC58 workloads and record template, animation, hook, upload, draw, and
      frame-time diagnostics.
- [ ] Confirm shared part/material resources do not collapse distinct setup or animation identity.
- [ ] Verify batch keys contain no entity-specific facts.
- [ ] Measure animation sampling, pose application, scene propagation, visibility, upload, and draw
      costs separately.
- [ ] Compare every-frame interpolation with legacy cadence only after measuring; retain conservative
      bounds and uninterrupted hooks under any visually validated optimization.
- [ ] Record deferred scripts/effect hooks encountered by the representative workload and hand that
      evidence set to the effects plan.
- [ ] Dry-run the effects plan against the landed hook, pose, resource, and ownership contracts.

#### Acceptance Criteria

- The representative authored animation population renders faithfully and shares resources as
  intended.
- No performance shortcut hides a correctness failure or invalidates bounds.
- The effects plan needs no alternate entity, pose, hook, or renderer architecture.
- Course corrections are recorded before cleanup.

#### Decisions and Course Corrections

- Pending implementation.

### Phase 7: Cleanup and Architectural Cutover

#### Deliverables

- Delete per-entity inline visual preparation, animation-backed deferral, count-and-discard rendering,
  and obsolete static-only instance vocabulary.
- Delete hollow tests for deferred animation and replace them with behavioral coverage.
- Update app architecture documentation and diagnostics terminology.

#### Acceptance Criteria

- No supported default-animation resident remains deferred.
- No production dynamic part uses a per-entity draw path or duplicate ready resource.
- Script-only behavior remains explicitly deferred with valid static presentation and retained source
  facts.
- Formatting, TypeScript checks, ESLint/Knip, Vitest, Rust checks, Clippy, and the browser workload
  harness pass.

#### Decisions and Course Corrections

- Pending implementation.

## Verification Strategy

- Exact two-part alpha-tested butterfly fixtures for setups `0x02000493` and `0x02000494`.
- Exact two-part opaque fixture for setup `0x020005AC`.
- Focused multi-material-part fixture proving every material partition survives preparation and
  submission; the representative butterflies intentionally do not stand in for this case.
- Numerous shared-template instances with independent phases and transforms.
- 30 Hz authored animation evaluated at a higher render cadence.
- Synthetic forward, reverse, cyclic-seam, multi-frame, and greater-than-two-second discontinuity
  traversal cases derived from retail `CSequence::update_internal`.
- Persistent frame-zero `SetOmega` without duplicate dispatch, including an identity-derived initial
  phase after frame zero.
- Conservative bound coverage through every frame and rotation-invariant envelope.
- Outdoor and environment-cell owner install/eviction.
- Transparent animated ordering and compatible adjacent-run batching.
- Script-only resident retaining static presentation for the next plan.

Run repository-selected format, check, lint, test, Rust, Clippy, and browser-harness commands. Tests
must use checked-in source-first fixtures unless a temporary local archive probe is explicitly
removed after recording evidence.

## Risks and Mitigations

### Static Fidelity Accidentally Pulls in Spawned Placement

Generalized root projection would introduce clocks, anchors, correction, and portal traversal without
an authored consumer. Keep authored placement/residency fixed and model visual-root modifiers below
it. Retain position frames losslessly for later plans.

### Template Identity Omits Appearance Facts

Construct keys once from canonical resolved immutable appearance inputs. Test
one-difference-at-a-time appearance cases and forbid GUID, owner, placement, scale, and animation time
from template identity.

### Pose and Placement Become Transform Soup

Use a closed authored composite with named root placement, visual-root modifier, part pose, and scale.
Do not introduce a generic layer list or a runtime correction field.

### Hooks Are Dropped or Triggered by Interpolation

Advance semantic frame crossings independently of render interpolation. Accepted elapsed time
processes each retail-selected departed frame in proven order; a retail-style gap discontinuity
processes none. Interpolation only samples visual pose. Persistent visual state is folded to an
identity-derived initial phase without replaying transient hooks.

### Conservative Bounds Are Dishonest

Setup spheres are not sufficient. Sweep prepared clips with the resolved appearance, then expand for
unbounded rotation. Runtime replacement variants are deferred with `ReplaceObjectHook` to the
effects plan. Fail staging if a required dependency prevents honest bound construction.

### Script-Only Residents Lose Their Existing Presentation

Do not promote script-only residents until the effects plan has a real execution consumer. Preserve
their static geometry and retained script identity rather than installing an inert dynamic shell.

## Definition of Done

- [ ] Every supported static-authored default-animation resident is promoted and animated.
- [ ] Identical appearances and animations share preparation/resources while entities retain
      independent playback state.
- [ ] Authored placement and residency remain authoritative and are not modified by animation root
      tracks.
- [ ] Required visual hooks, including `SetOmega`, execute deterministically.
- [ ] Rigid parts render through compatible frame-streamed instance cohorts.
- [ ] Conservative bounds cover prepared animation and visual-root rotation.
- [ ] No entity-attachment runtime is introduced without the spawned lifecycle consumer assigned to
      the spawned-entity plan.
- [ ] Script/effect behavior is retained and explicitly handed to the next plan.
- [ ] No spawned feed, motion-table resolver, sparse-anchor system, or Explorer host exists merely as
      scaffolding.
- [ ] Diagnostics distinguish templates, animations, entities, visible parts, uploads, cohorts, and
      draws.
- [ ] All touched code passes repository formatting, linting, tests, Rust checks, and Clippy with
      warnings denied.
- [ ] Architecture documentation describes the landed authored-animation ownership boundaries.

## Open Questions

None. Runtime part replacement and entity attachments have explicit owners in the next two plans;
render-cadence tuning requires visual and profiling evidence after the first faithful path lands.
