# Holtburger 3D Static-Authored Animation Runtime Plan

Status: Complete after renewed retail validation and lifecycle hardening (2026-08-01)
Created: 2026-07-31
Parent roadmap: `docs/plans/holtburger-3d-dynamic-entity-runtime-plan.md`

## Post-Completion Convergence Review — 2026-08-01

This document remains the execution record for the completed canonical slice at `c09eb3c2`. Its
checkboxes and original completion claims are unchanged. The parallel Claude slice at `c938a438` is
donor evidence only and does not satisfy or replace any claim in this worktree.

| Concern                                   | Branch-local status   | Convergence treatment                                                         |
| ----------------------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| Authored dynamic activation and lifecycle | Complete on `3d-next` | Preserved as canonical foundation                                             |
| Departed-frame semantic traversal         | Complete on `3d-next` | Preserved; Claude's final-frame-only traversal is rejected                    |
| Smooth render-cadence rigid-part poses    | Complete on `3d-next` | Required canonical presentation behavior                                      |
| Typed `TransparentPart` source/transport  | Complete on `3d-next` | Donor evidence reimplemented by convergence Phase 3; playback remains Phase 4 |
| Visual-template atlas ownership           | Complete on `3d-next` | One geometry-and-atlas repository landed in convergence Phase 2               |

Smooth interpolation is an intentional final-client quality choice. Semantic frame selection and hook
execution remain discrete and retail-ordered; interpolated presentation samples never manufacture
semantic crossings or hook events.

The completed slice tied promoted dynamic texture lifetime to the containing static-layer atlas
revision. That was correct for its authored-only scope, but it is not claimed as the final spawned
materialization architecture. The active convergence plan owns that clean cutover without rewriting
this historical record.

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

Before implementation, the app classified setup-backed residents with default animation as dynamic
but deferred them instead of rendering them. `DynamicEntitySystem` prepared each entity
independently, `AnimationSystem` only applied already-sampled poses, and the renderer counted visible
dynamic entities without submitting their geometry. This plan closed that complete authored path.

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

Progress: Complete (2026-08-01)

#### Deliverables

- Replace the alias-only dynamic commit with an authored dynamic source carrying setup identity,
  canonical host-resolved appearance identity and visual selection, scale, placement, default
  animation ID, default script/table IDs, and behavior classification.
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

- The source decoder now computes one closed `ResolvedObjectBehavior` union covering `none`,
  `animation-only`, `script-only`, and `animation-and-script`. A script table alone is sufficient to
  establish script capability, and the type requires every script-capable arm to contain a script or
  script-table ID.
- `AuthoredDynamicSource` is an explicit animation-capable source carrying authored identity, exact
  SetupModel ID, host-resolved visual selection and canonical appearance key, scale, placement,
  bounds, and behavior IDs. Decoded motion graphs and behavior payloads were removed from the
  presentation contract rather than retained as dormant spawned-runtime scaffolding.
- Dynamic sources remain inside their resolved authored layer source. They are not duplicated on the
  landblock commit envelope; outdoor and EnvCell commits each have one authoritative source of the
  promoted population.
- `DynamicEntitySystem.replaceOwner` installs the complete promoted population as one synchronous
  owner-set cutover. Asynchronous preparation is guarded by a monotonic owner generation, returns an
  explicit `ready` or `superseded` outcome, and cannot publish geometry after eviction or
  replacement. A current preparation failure withdraws the complete new owner set.
- The unused spawned commit variant, spawned owner namespace, world-resident identity arm, and
  entity-attachment runtime were removed. Holding-location source facts remain decoded for their
  later concrete consumers.
- Concession: static geometry worker sources retain their promoted dynamic sources because static
  and dynamic residents can share the same transferable geometry buffers. The worker uses that list
  only to keep runtime-owned buffers from being detached during static preparation.
- Deferred debt at this gate was the inline dynamic preparer's first-material-only, per-entity
  preparation. Phase 2 replaces both limitations with shared complete templates. Phase 3 still owns
  contribution batching and submission, while playback and hooks remain intentionally inactive
  until Phase 5's complete activation gate.
- Verification: focused source/classification, owner-generation, decode, commit, EnvCell, and runtime
  tests pass (39 tests), together with the full TypeScript/Svelte check, ESLint, Knip, Rust check, and
  Clippy with warnings denied.

### Phase 2: Prepare Shared Visual Templates

Progress: Complete (2026-08-01)

#### Deliverables

- Add canonical appearance-aware `ObjectVisualTemplateKey` and `PartVisualTemplateKey` types.
- Add an injected template preparer producing complete part geometry, material partitions, texture
  facts, setup transforms, and base bounds.
- Add a lease-owning template manager with shared in-flight preparation and explicit
  preparing/ready/failed states.
- Reuse `GeometryManager` and `ResidentTextureAtlas` as physical resource authorities.
- Consume the complete host-resolved effective appearance during preparation while keeping entity
  scale out of template identity.

#### Acceptance Criteria

- Many identical residents perform one CPU preparation and share physical geometry/material/texture
  resources.
- Different effective appearances do not alias.
- Owner eviction during preparation cannot publish stale templates or leak leases.
- Complete material partitions replace the current first-material-only behavior.

#### Decisions and Course Corrections

- Rust content resolution remains the sole authority for applying `ObjDesc` animation-part and
  texture changes. The frontend contract now receives the complete selected parts/materials plus a
  canonical `appearanceKey`; the previous partial appearance payload was removed so the frontend
  cannot replay or reinterpret host decisions.
- `ObjectVisualTemplateKey` is exactly SetupModel ID plus canonical appearance key. Entity identity,
  owner, placement, scale, animation identity, and phase are excluded. `PartVisualTemplateKey`
  identifies one part inside that immutable template, while physical geometry remains keyed by the
  resolved GfxObj identity and can therefore be shared across setups and appearances.
- `ObjectVisualTemplateManager` owns one explicit preparing/ready/failed entry per template key,
  shares in-flight preparation across authored owners, leases geometry through `GeometryManager`,
  and guards late completion with owner generations. Owner replacement validates its complete
  requirement set before releasing the previous generation; an evicted preparation cannot publish
  or retain device resources.
- Prepared parts retain every contiguous material/polygon partition. The old first-material-only
  path was deleted, and the material-binding vocabulary was generalized because the same lossless
  contract now serves static and dynamic object draws.
- Dynamic template texture requirements join static requirements before the authored layer's single
  atlas claim. `ResidentTextureAtlas` remains the physical texture authority and layer replacement
  remains the only publication/lifetime boundary; the template manager does not create a competing
  texture lease system.
- Concession: template preparation is currently main-thread and injected behind
  `ObjectVisualTemplatePreparer`. The host has already decoded the source and the representative
  templates are small, so a worker handoff would add transfer and lifetime machinery before
  measurement justifies it.
- Deferred debt: prepared draw partitions are staged but are not yet emitted as visible,
  frame-streamed contributions. Phase 3 owns that renderer path. Animation playback and hooks remain
  inactive until the complete Phase 5 activation gate.
- Verification: 53 focused material, texture-dependency, template-sharing, owner-generation,
  decode, runtime, geometry-worker, and EnvCell tests pass, together with the full
  TypeScript/Svelte check, ESLint, Knip, Rust check, and Clippy with warnings denied.

### Phase 3: Submit Dynamic Parts Through Frame-Streamed Instancing

Progress: Complete (2026-08-01)

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

- Dynamic roots now emit renderer-neutral `VisibleRigidPartContribution` values. Each contribution
  carries one complete immutable part/range batch key, one composite render domain, the resolved draw
  partition, final landblock-space transform, color modifier, and transparent sort facts. The
  renderer resolves device geometry without reaching back into mutable entity state.
- Object instance records, frame-streamed templates, arena payload constants, transparency policy,
  and diagnostics use shared object vocabulary. Installation-scoped persistent streams remain
  correctly static-specific; only the genuinely shared mechanism was generalized.
- Interim Phase 3 source scale composition follows the existing static baker's
  `authored root * source scale * part transform` order. Two residents sharing a template retain
  independent transforms while emitting the same part/range batch identity. Phase 4 retail review
  subsequently proved this existing order is not faithful for non-uniform scale; see the Phase 4
  blocker below before treating it as the final pose contract.
- Opaque and alpha-tested frame contributions sort by complete compatibility and become adjacent
  instance runs before upload. Transparent contributions join static transparency in one global
  near/far ordering; runs form only after that ordering. Batch compatibility includes source class,
  render domain, geometry, material/range identity, and landblock frame, so portal domains cannot
  merge accidentally.
- The reusable frame arena performs at most one opaque/cutout upload and one blended upload per
  sequentially rendered view. Keeping the two pass populations separate preserves transparent
  camera ordering and avoids retaining stale arena ranges across a reset; upload counts and bytes
  are explicit diagnostics rather than a hidden cost.
- Dynamic selection and submission diagnostics now distinguish visible entities, visible part
  ranges, submitted dynamic draws, submitted dynamic instances, and shared frame uploads. Static
  draw totals no longer absorb dynamic submissions.
- Activation remains deliberately closed: staged dynamic roots have null query bounds, so the
  production scene query cannot expose a frozen or bounds-incorrect intermediate presentation.
  Phase 4 installs conservative animation bounds and Phase 5 opens visibility together with
  playback and supported hooks. Direct system/renderer fixtures exercise the production
  contribution and batching path meanwhile.
- Verification: 56 focused ownership, template, contribution, render-world, ordering/domain,
  instance-buffer, geometry-worker, and runtime tests pass. The full frontend suite passes (76 files,
  463 tests), together with TypeScript/Svelte checking, ESLint, and Knip.

### Phase 4: Prepare Shared Animation Resources and Bounds

Progress: Complete (2026-08-01)

#### Deliverables

- Add compact typed Tauri animation transfer backed by `ContentAssetRequest::Animation`.
- Add `AnimationAssetRepository` with shared in-flight preparation, explicit failure, acquired
  handles, and deterministic release.
- Prepare flat part frames, position frames, frame timing, and normalized typed hooks without
  starting playback.
- Inspect representative setup-default animations and classify each encountered hook as
  visual-in-plan, later-plan-deferred, or unsupported-with-evidence.
- Define activation policy by hook class: supported visual hooks activate; deferred
  non-structural effects remain observable while visual playback continues; deferred structural
  visual hooks such as `ReplaceObject` and unclassified visual hooks retain static presentation.
- Compute conservative local bounds across every prepared part frame, resolved appearance, setup
  scale, and unbounded visual-root rotation.

#### Acceptance Criteria

- Repeated residents referencing one animation perform one transfer/preparation.
- Frame-time sampling performs no I/O, DAT decoding, or dependency discovery.
- Butterfly bounds exceed their radius-zero setup spheres and remain valid through wing motion and
  continuous omega rotation.
- Every hook in the representative evidence set has an explicit activation class and semantic
  traversal location.

#### Decisions and Course Corrections

- 2026-08-01 evidence scope: representative animation examples replace an exhaustive archive hook
  census. The prepared format remains lossless for hooks outside the sample.
- 2026-08-01 scope cut: appearance-time `ObjDesc.anim_part_changes` remain template input;
  animation-time `ReplaceObjectHook` execution and its replacement-aware bounds move to the effects
  plan.
- A compact typed `HBAN` host record now transfers frame-major part/position frames plus hook frame,
  authored order, type/name, raw direction, and typed or raw payload facts. Frontend decoding
  validates redundant transport facts, discards them for known commands, and emits a semantic hook
  union: `SetOmega` is supported visual behavior, `ReplaceObject` is deferred structural behavior,
  non-structural effects remain observable and deferred, and unclassified visual behavior blocks
  activation.
- `AnimationAssetRepository` shares one in-flight load per animation ID, exposes acquired handles
  with exact release, retains explicit failed state, and requires deliberate failed-entry eviction
  before retry. Frame-rate policy is recorded once as the retail setup-default 30 Hz rate.
- Animation acquisition now settles atomically with visual-template preparation for each authored
  owner generation. Superseded or failed generations release every fulfilled handle, while current
  entities retain one exact handle until owner eviction.
- Animation/appearance preparation validates rigid-part coverage and computes bounds by applying
  the same retail-shaped part composition used by static baking and dynamic rendering. A supported
  `SetOmega` hook expands the complete frame sweep to an origin-centered rotation-invariant
  envelope. Deferred structural and unsupported visual hooks instead produce an explicit
  retain-static-presentation outcome with the blocking command and traversal location.
- The production Tauri adapter and browser-harness content source both implement the same typed
  animation source boundary; the harness host exposes the same `load_animation_bytes` response as
  Tauri rather than a second decoder.
- Verification: focused typed-transfer, decoder, repository-lifetime, owner-generation,
  non-uniform-transform, swept-bound, activation-policy, and runtime-staging tests pass,
  together with TypeScript/Svelte checking, ESLint, Knip, and Rust Clippy with warnings denied.

#### Resolved Transform Course Correction

- Retail `Frame::combine` (`acclient.c:314080-314105`) scales the animation frame origin by
  `CPartArray::scale` while composing root and animation orientations without scale.
- Retail `CPartArray::SetScaleInternal` (`acclient.c:313765-313815`) separately multiplies that source
  scale into each part's setup-authored `gfxobj_scale`, which `CPhysicsPart::Draw` submits through
  `Render::SetObjectScale`.
- The previous static baker and interim dynamic path instead pre-baked setup part scale into a matrix
  and left-multiply the complete part transform by source scale. For non-uniform scale this scales
  the rotation basis rather than only the animation-frame origin and local geometry axes. Animation
  frames also contain no setup part scale, so replacing the resting pose without a separate scale
  contract would drop it.
- Approved and completed 2026-08-01: placement and animation poses are rigid; setup part scale stays
  on the resolved part/template; one shared composition function scales pose translation by source
  scale while applying setup-times-source scale on local geometry axes. Static baking, dynamic part
  nodes, resting bounds, and animation sweeps all consume that function. A non-uniform rotated-pose
  fixture proves the orientation is not world-axis pre-scaled, and worker-transfer fixtures prove
  the helper accepts structurally cloned matrices without relying on prototypes.

### Phase 5: Execute Static Default Animation and Visual Hooks

Progress: Complete (2026-08-01)

#### Deliverables

- Implement pure semantic frame selection, looping, direction, crossed-frame detection, and
  fractional part-pose interpolation.
- Add per-entity setup-default playback with an independent deterministic phase derived from stable
  authored resident identity; shared animation resources never imply shared playback clocks.
- Add a deterministic effect owner and implement the visual hooks required by the representative
  evidence set, including persistent replacement-style `SetOmega` visual-root state.
- Traverse semantic hooks using retail's departed-frame, direction-filtered ordering and carry
  accepted leftover time across cyclic seams without recursion.
- Treat elapsed gaps above two seconds as discontinuities: retain playback and persistent hook state,
  rebase the entity clock, and dispatch no missed hooks.
- Fold persistent visual hooks crossed before an identity-derived initial phase into activation
  state without emitting transient or deferred effect hooks.
- Advance `SetOmega` on a deterministic 30 Hz authored-behavior clock and interpolate committed
  visual-root orientations for rendering; never apply the raw omega payload once per render frame.
- Compose authored root, visual-root modifiers, rigid-part pose, and scale once in entity-owned
  presentation publication, then expose final part transforms for visibility and rendering.
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
- `DynamicEntitySystem` publication does not own playback clocks or resource preparation.
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
- `AnimationSystem` now owns only independent identity-derived clocks, fixed 30 Hz semantic steps,
  retail cyclic traversal, and fractional rigid-pose sampling. It returns immutable presentation
  samples and has no scene, resource, residency, or renderer port.
- `EffectSystem` owns persistent visual-effect state. It folds `SetOmega` and implemented
  `TransparentPart` history before an independently phased first frame, integrates the decompiled
  axis-angle `delta * current` rotation at the behavior clock, and exposes fractional effect samples
  without mutating committed state. Deferred hooks retain their command and semantic traversal
  location in bounded observations.
- `DynamicEntitySystem` publishes visual-root, rigid-part, and per-part render-state samples at render
  cadence. Authored placement remains the dynamic root, visual modifiers occupy one named child root,
  and retail part composition remains the only scale-bearing layer. Position frames stay prepared
  and unused.
- Activation is a synchronous final cutover after template, animation, hook policy, initial
  phase, initial pose, and conservative bounds are ready. Clips with structural or unknown visual
  blockers publish the resting presentation and static bounds instead of disappearing or partially
  animating.
- Concession: reverse traversal is implemented and fixture-covered from retail's clamp/leftover
  rules, but Plan A production playback is setup-default forward cyclic playback. Reverse visual
  validation remains attached to the first authored consumer that actually requests it.
- Verification: the full frontend suite passes (83 files, 477 tests), including forward/reverse
  seam traversal, rigid interpolation, independent phase, frame-zero persistent-state folding,
  fixed-step discontinuity, deferred-hook observation, static visual fallback, activation bounds,
  and render-path integration. TypeScript/Svelte checking, ESLint, and Knip also pass.

### Phase 6: Resteer on the Real Authored Workload

Progress: Complete (2026-08-01)

#### Task Checklist

- [x] Exercise the exact DA55/DC58 workloads and record template, animation, hook, upload, draw, and
      frame-time diagnostics.
- [x] Confirm shared part/material resources do not collapse distinct setup or animation identity.
- [x] Verify batch keys contain no entity-specific facts.
- [x] Measure animation sampling, pose application, scene propagation, visibility, upload, and draw
      costs separately.
- [x] Compare every-frame interpolation with legacy cadence only after measuring; retain conservative
      bounds and uninterrupted hooks under any visually validated optimization.
- [x] Record deferred scripts/effect hooks encountered by the representative workload and hand that
      evidence set to the effects plan.
- [x] Dry-run the effects plan against the landed hook, pose, resource, and ownership contracts.

#### Acceptance Criteria

- The representative authored animation population renders faithfully and shares resources as
  intended.
- No performance shortcut hides a correctness failure or invalidates bounds.
- The effects plan needs no alternate entity, pose, hook, or renderer architecture.
- Course corrections are recorded before cleanup.

#### Decisions and Course Corrections

- Radius-one production harness runs activated all 44 DA55 and 162 DC58 default-animation
  residents. Each workload retained exactly three setup/appearance templates and three animation
  resources, with one animation handle per entity and no preparation failure, visual fallback, or
  deferred hook in the representative population.
- DA55's captured view selected 16 entities / 88 part ranges and submitted 40 dynamic draws / 88
  instances. DC58 selected 134 entities / 536 part ranges and submitted 40 dynamic draws / 536
  instances. Both workloads used the shared frame arena's two uploads; DC58 uploaded 117,200 bytes
  for its complete static/dynamic blended and opaque populations.
- Captured animation sampling and pose publication were approximately 0.1 ms / 0.1 ms for 44 DA55
  entities and 0.3-0.5 ms / 0.2 ms for 162 DC58 entities in the software-rendered harness. This is
  not a measured bottleneck, so render-cadence interpolation remains the policy and no cadence
  optimization was introduced.
- Hook diagnostics initially retained every observation produced when cyclic playback revisited the
  frame-zero `SetOmega` hook. The real workload proved that would grow without bound, so diagnostics
  now retain cumulative outcome counts plus the most recent 256 provenance records. Runtime hook
  state and behavior were unchanged.
- High and ground-scale DC58 captures showed the populated generated layer without an exploded root
  or browser error. The ground capture also contains 5,621 static generated instances, so it cannot
  isolate butterfly pixels from dense foliage and is not claimed as retail pose signoff. It is
  sufficient to reject a gross whole-layer transform failure; fine pose/rotation tuning remains a
  side-by-side interactive visual task and did not justify changing the proven cadence or transform
  contracts.
- The effects-plan dry run reuses the landed owner-atomic entity trees, template/animation leases,
  `EffectSystem` provenance, visual-root layer, entity-owned presentation publication,
  conservative-bound activation, and frame-streamed renderer path. Plan B must add its concrete
  script/effect consumers and staged replacement selections, but needs no alternate entity,
  presentation, effect, or renderer architecture.
- Representative clips emitted only supported `SetOmega`; combined residents retain script IDs for
  Plan B, and the synthetic deferred-effect fixture proves those events remain observable when
  encountered.

### Phase 7: Cleanup and Architectural Cutover

Progress: Complete (2026-08-01)

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

- The per-entity preparer, animation-backed runtime deferral, count-and-discard renderer branch,
  spawned commit variant, dormant attachment runtime, and static-only vocabulary were removed or
  generalized at the phase that acquired their replacement consumer. No compatibility shim or
  temporary per-entity draw path remains.
- Diagnostics now use active authored-dynamic vocabulary and expose resource sharing, activation
  policy, bounded hook decisions, semantic/sampling cost, pose publication cost, visibility,
  uploads, draws, and instances at their owning layers. The explorer frame panel and browser harness
  consume the same runtime snapshot.
- `ARCHITECTURE_AUDIT.md` documents the HBAN source boundary, shared template/animation ownership,
  fixed semantic clock, persistent hook state, render-cadence pose publication, activation bounds,
  static visual fallback, and shared object submission path.
- A harness-only `--camera-height` control was added after the default 600-unit survey view proved
  too distant for useful visual inspection. It changes only diagnostic camera placement, not runtime
  content, culling, animation, or rendering policy.
- Final verification: Prettier and Rust formatting checks pass; TypeScript/Svelte checking, ESLint,
  Knip, 84 frontend test files / 480 tests, 54 Rust tests, Cargo check, and Clippy with warnings
  denied pass. Radius-one DA55 and DC58 browser harness runs pass without browser errors and exercise
  44 and 162 active residents respectively.

### Phase 8: Retail Visual Validation and Performance Correction

Progress: Complete (2026-08-01)

#### Trigger

Interactive comparison in landblock `0xDA56FFFF` showed authored butterflies orbiting materially
slower than retail/legacy and poor frame performance. The previous harness captures could reject a
gross whole-layer transform failure but could not isolate dynamic residents or establish retail
angular-speed parity, so Plan A's visual/performance signoff was premature.

#### Task Checklist

- [x] Reinspect retail static-object omega application and identify the runtime mismatch.
- [x] Correct static `SetOmega` integration and add a regression fixture for retail angular speed.
- [x] Add harness-only dynamic isolation without changing production runtime selection policy.
- [x] Record steady-state runtime-update/render CPU time, frame delivery, upload/draw counts, and
      GPU-facing workload evidence instead of treating animation/pose timings as total performance.
- [x] Re-run `0xDA56FFFF` with isolated dynamic captures and compare motion against retail/legacy.
- [x] Apply only evidence-backed corrections and rerun all repository gates.

#### Evidence and Course Correction

- `CPhysics::UseTime` gates physics updates at `MIN_QUANTUM_93 == 1 / 30`, and
  `CPhysicsObj::animate_static_object` separately accepts updates at
  `MIN_QUANTUM_97 == 1 / 30`.
- On each accepted static update, retail calls `Frame::grotate(m_omegaVector)` directly. Unlike the
  ordinary moving-physics path, it does not multiply the vector by elapsed seconds.
- The landed effect owner multiplied authored omega by `1 / 30` on every semantic step and by raw
  fractional seconds during interpolation. It therefore treated a per-update rotation vector as
  radians per second and produced approximately one-thirtieth of retail angular speed.
- The earlier phrase “cyclic `SetOmega` observations” referred to a looping animation departing its
  authored frame-zero hook again on later cycles. The hook replaces persistent omega each time; it
  does not accumulate another angular velocity.
- `EffectSystem` now applies the raw authored omega once per fixed semantic update and interpolates by
  the fractional progress toward the next update. A representative `0.026797784` rad/update fixture
  proves 30 accepted steps produce `0.80393352` radians in one second, matching retail's direct
  application at the 30 Hz physics gate.
- The browser harness now supports steady-state measurement plus two source-level comparison modes:
  dynamic-only retains terrain and promoted outdoor dynamics while stripping outdoor statics;
  dynamic-excluded retains the static population while stripping promoted dynamics. These are
  harness-only decoded-source decorators, not production render-policy switches.
- A radius-one DA56 comparison recorded 30 active residents, 15 visible entities, 96 submitted
  dynamic instances, and 72 dynamic draws. Dynamic-only sustained 180 frames in three seconds with
  `0.77 ms` average synchronous frame work and a `16.9 ms` longest frame gap.
- An initial complete/static-excluded pair produced only 38/39 frames in three seconds with an
  approximately `82 ms` longest frame gap. Dynamic-only produced 180 frames, proving dynamic
  submission was not the source of that sample's cliff, but the isolated result did not establish a
  Plan A regression.
- A controlled pre-Plan-A `HEAD` snapshot and current static-excluded build were then run against
  the same DA56 assets, camera, radius-one content, three-second settle, and three-second
  steady-state window. The pre-plan renderer delivered 53 frames and the current renderer delivered 54. Their static GPU-facing counters were identical: 606 draws, 186,634 triangles, 5,083
  persistent instances, 659 transparent instances, 46 program changes, 831 texture-page binds, and
  one 52,720-byte frame-instance upload.
- The current complete population delivered 53 frames in the same steady-state window while adding
  76 dynamic draws and 120 dynamic instances. Its measured synchronous frame work averaged
  `5.25 ms`; the static-excluded run averaged `4.16 ms`.
- Performance conclusion: the poor initial static-heavy sample is reproducible as a heavy
  generated-static workload but not as a Plan A static-rendering regression. Plan A touched shared
  object submission and static transform preparation, so static performance was not assumed
  unchanged; the controlled pre/post workload establishes parity for this representative view.
  Structural generated-static batching/state-ordering remains adjacent renderer debt.
- Interactive DA56 comparison after the omega correction confirmed that the butterflies now match
  the observed retail/legacy motion.
- Post-correction verification passes TypeScript/Svelte checking, ESLint, Knip, Prettier, 85
  frontend test files / 484 tests, 54 Rust tests, Cargo check, Rust formatting, and Clippy with
  warnings denied. The renewed interactive motion comparison and controlled pre/post performance
  comparison both pass.

### Phase 9: Signoff Hardening

#### Trigger

Post-landing code review found that the proven visual path still left lifecycle and contract
invariants weaker than the plan intended. This phase reopens implementation signoff without
expanding Plan A into runtime part replacement, attachments, or spawned-entity behavior.

#### Task Checklist

- [x] Replace keyframe-AABB bounds with a coarse swept-part-sphere policy that conservatively covers
      every interpolated rigid pose; retain the final origin-centered envelope for visual-root
      `SetOmega` rotation.
- [x] Collapse each dynamic part's immutable template facts, active scene node, draw units, and
      transparent sort center into one complete record computed at preparation/activation time.
- [x] Stage template, animation, hook-policy, bounds, and entity facts without disturbing the active
      owner generation; publish the complete replacement synchronously and retire the old generation
      only after the new one is valid.
- [x] Track all in-flight owner preparations, invalidate them when shutdown begins, await their
      settlement, and release acquired handles before destroying shared repositories. Do not add
      interruptible asset jobs without evidence that quiescence is insufficient.
- [x] Normalize decoded hooks into a semantic discriminated union. Retain raw type/payload facts only
      for deferred or unsupported commands and derive diagnostic labels instead of carrying redundant
      provenance through known commands.
- [x] Make static-realization continuation lifetime explicit so no authored-dynamic publication can
      begin after runtime shutdown or stale scene-interest replacement.
- [x] Add focused failure, supersession, teardown, interpolated-bound, and impossible-hook-contract
      regressions, then rerun repository and harness gates.

#### Decisions and Course Corrections

- Conservative animated bounds use one geometry-origin sphere per part after source and setup-default
  scale. The union of that sphere at every keyframe translation covers linear translation and every
  slerped orientation between adjacent frames. This intentionally trades culling precision for a
  cheap, deterministic proof of coverage.
- Preparation is a resource-validation stage, not a second commit pipeline. Jobs remain ordinary
  promises; generations suppress stale publication and shutdown awaits their settlement.
- Runtime hook contracts keep only facts with a named execution, gating, or diagnostic consumer.
  Transport validation still checks redundant host facts at the decode boundary, then discards them.
- `ReplaceObjectHook` remains deferred to Plan B. Entity attachments remain deferred to Plan C.
- Dynamic geometry now uses generation-private resource owners, matching the existing static-revision
  ownership pattern. New geometry is materialized while the old generation remains fully retained;
  allocation or validation failure therefore occurs before static publication and leaves both the
  active static and dynamic generations untouched.
- Static realization awaits geometry, atlas, and authored-dynamic companion preparation together.
  The final companion commit contains only validated scene-map, playback-map, and owner cutovers;
  no asset I/O, decoding, geometry allocation, or hook classification remains in that path.
- Shutdown first makes static realizations stale, awaits their complete continuations, then awaits
  dynamic owner preparations before destroying template and animation repositories. Focused tests
  prove pending shutdown waits and every acquired animation reference returns to its owner.
- Normalized known hooks retain frame, authored order, direction, and semantic payload only.
  Redundant type/name/raw-direction facts are validated and discarded at decode; raw type/payload
  facts survive only on deferred or unsupported arms. Diagnostics derive command labels and blocking
  reasons from the semantic union.
- Verification passes 85 frontend test files / 495 tests, TypeScript/Svelte checking, ESLint, Knip,
  Prettier, 54 Rust tests, Cargo check and formatting, and Clippy with warnings denied.
- A DA56 radius-one dynamic-only steady-state run retained 30 active residents, 16 visible entities,
  112 submitted dynamic instances, 72 dynamic draws, no browser errors, and approximately `1.0 ms`
  average synchronous frame work. A separate clear-and-reload lifecycle run reloaded the source,
  restored seven active residents with exact template/animation reference counts, and reported no
  browser errors.

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

Setup selection spheres are not sufficient. Derive a geometry-origin sphere from every resolved,
scaled part, sweep those spheres through authored translations, then expand for unbounded root
rotation. Runtime replacement variants are deferred with `ReplaceObjectHook` to the effects plan.
Fail staging if a required dependency prevents honest bound construction.

### Script-Only Residents Lose Their Existing Presentation

Do not promote script-only residents until the effects plan has a real execution consumer. Preserve
their static geometry and retained script identity rather than installing an inert dynamic shell.

## Definition of Done

- [x] Every supported static-authored default-animation resident is promoted and animated.
- [x] Identical appearances and animations share preparation/resources while entities retain
      independent playback state.
- [x] Authored placement and residency remain authoritative and are not modified by animation root
      tracks.
- [x] Required visual hooks, including `SetOmega`, execute deterministically and pass renewed
      retail/legacy visual comparison.
- [x] Rigid parts render through compatible frame-streamed instance cohorts.
- [x] Conservative bounds cover prepared animation and visual-root rotation.
- [x] No entity-attachment runtime is introduced without the spawned lifecycle consumer assigned to
      the spawned-entity plan.
- [x] Script/effect behavior is retained and explicitly handed to the next plan.
- [x] No spawned feed, motion-table resolver, sparse-anchor system, or Explorer host exists merely as
      scaffolding.
- [x] Diagnostics distinguish templates, animations, entities, visible parts, uploads, cohorts, and
      draws.
- [x] All touched code passes repository formatting, linting, tests, Rust checks, and Clippy with
      warnings denied.
- [x] Architecture documentation describes the landed authored-animation ownership boundaries.

## Open Questions

None. Runtime part replacement and entity attachments have explicit owners in the next two plans;
render-cadence tuning requires visual and profiling evidence after the first faithful path lands.
