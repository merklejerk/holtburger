# Holtburger 3D Hybrid Entity Shadowing Plan

Status: Proposed
Created: 2026-08-26
Resteered: 2026-08-28
Revalidated against `3d-next`: 2026-08-28 (`68e65e46`)

## Context and Boundaries

### Goal

Ground spawned players, NPCs, and mobs with two domain-appropriate techniques: outdoor PSSM
shadows on terrain and Buildings geometry, and cheap analytic grounding decals evaluated directly
by EnvCell-shell shaders indoors.

### In Scope

- A producer-resolved dynamic-entity presentation category with the narrow values `player`, `npc`,
  `mob`, and `other`.
- Shadow participation only by spawned dynamic entities categorized as player, NPC, or mob.
- Outdoor PSSM:
  - regional sun direction;
  - material-agnostic opaque caster geometry;
  - terrain inside the configured shadow distance and Buildings-layer geometry as receivers;
  - stable cascades, bounded PCF, cascade blending, and tunable bias.
- Indoor analytic grounding:
  - EnvCell shells as the only receivers;
  - presentation bounds as the only caster proxy;
  - at most eight grounding casters per visible EnvCell;
  - a cheap squared-distance fragment calculation inside a shell-only object-program variant;
  - visibility-island and influence-volume filtering so cell-grid rooms remain continuous without
    admitting unrelated stacked cells.
- Flat and portal rendering.
- One default-on master switch plus live Explorer controls for the tunable outdoor and indoor
  appearance parameters.
- Focused pure, shader, target-lifecycle, and browser-harness verification.

### Out of Scope

- One universal indoor/outdoor shadow algorithm.
- Indoor PSSM, per-cell shadow maps, per-island shadow maps, or light-space portal traversal.
- Any new indoor shadow-map light or sunlight propagation through EnvCell portals. Existing
  interior-object lighting remains unchanged and is only the base shading that grounding darkens.
- Screen-space directional occlusion, deferred grounding decals, receiver-mask attachments, or an
  indoor post-processing pass.
- Feet, skeleton, animation-part, collision-shape, or material analysis for indoor grounding.
- Static terrain, buildings, explicit objects, generated scenery, EnvCell shells, EnvCell
  residents, particles, or authored-static dynamics casting outdoor shadows.
- Dynamic entities receiving shadows or self-shadowing.
- Explicit/Generated outdoor objects or EnvCell residents receiving either effect.
- Alpha-aware outdoor caster silhouettes. Eligible visible rigid geometry writes opaque shadow
  depth regardless of material alpha or blend policy.
- Physically accurate indoor shadows, static-structure occlusion, or cross-room light transport.
- A general render graph, generic light/shadow framework, deferred renderer, or new material system.
- Copying the TUI's complete item taxonomy or promoting 3D presentation policy into authoritative
  world state.
- Profiling or hardware-performance acceptance gates. Final tuning and the keep/remove decision are
  user-owned visual-review decisions.
- Investigating retail shadow code paths or adding retail compatibility markers for this feature.
- Modifying `acclient-eor-source`.

## Ground Truth

### User Decisions

- Only spawned players, NPCs, and mobs participate; all other dynamic and authored-static entities
  do not.
- Classification is an explicit category computed while producer facts are available. Radar color
  is not classification input.
- The proven TUI classifier is the policy reference; the 3D Client and Explorer producers
  reimplement it locally without a census.
- Outdoor receivers are terrain and Buildings-layer geometry.
- “Cell structures” means EnvCell shell geometry, not EnvCell residents.
- Outdoor scenes use PSSM; indoor scenes use approximate grounding decals rather than full shadows.
- Indoor grounding makes no assumption that an entity has feet or that any model part represents
  contact with the floor.
- Indoor decals are evaluated by the EnvCell-shell shader rather than by a receiver attachment or
  post-process.
- Each EnvCell evaluates at most eight candidate decals.
- Candidate ordering is untouched when eight or fewer candidates survive. Only overflow invokes
  nearest-camera selection, using squared distance and GUID as a stable tie-breaker.
- Shadows default on. Appearance defaults are provisional and are tuned during final visual review.
- Baseline WebGL2 is the target; no separate capability-discovery or browser-matrix phase is needed.

### Current Entity Contract

- `crates/holtburger-core/src/dynamic_entity_view.rs`
  - `DynamicEntityView` is the common frontend-reconstructible projection used by Client and
    Explorer;
  - `DynamicEntityIdentityView` intentionally carries only GUID, WCID, and name;
  - `DynamicEntityPresentationView` is the serialized home for producer-resolved presentation
    facts such as radar and the new category;
  - `DynamicEntityViewSource::from_projection` is the common Explorer projection adapter and must
    receive the already-resolved category rather than reconstruct it.
- `crates/holtburger-core/src/client/dynamic_entity_view.rs`
  - `project_client_dynamic_entity` still has object-description flags and `ItemType` when it
    constructs the frontend view.
- `apps/holtburger-3d/host/src/explorer_entity_driver.rs`
  - Explorer template preparation still has `WeenieType`, item type, and authored attackable state;
  - those facts do not all survive into `DynamicEntityProjectionInput`, so Explorer must resolve
    category here and retain the value with its app-local live instance.
- `apps/holtburger-3d/host/src/explorer_entity_delivery.rs`
  - Explorer publishes through the same `DynamicEntityView` shape as Client and can pass the
    retained category into the pure source-neutral projector.
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/classification.rs`
  - is the proven reference for player, creature, attackable, and vendor precedence;
  - remains a reference, not a shared frontend dependency.
- `apps/holtburger-3d/src/lib/game/runtime/dynamic-entity-feed.ts`
  - validates the host view and must add one required category field.
- `apps/holtburger-3d/src/lib/game/runtime/dynamic-entity-presentation.ts` and
  `apps/holtburger-3d/src/lib/game/systems/dynamic-presentation-source.ts`
  - adapt host views into renderer-owned dynamic presentation state;
  - `DynamicPresentationSource` is the common app-local seam for spawned and authored-static
    dynamics, so it must carry the explicit category (`other` for authored-static sources).
- `apps/holtburger-3d/src/lib/game/resolution/authored-dynamic-presentation.ts`
  - produces authored-static dynamics, which remain category `other`.

### Current Renderer Contract

- `apps/holtburger-3d/src/lib/game/renderer/renderer.ts`
  - `FrameSettings` is the cold frontend-owned renderer-policy contract;
  - `DEFAULT_FRAME_SETTINGS` reads defaults from `FRONTEND_TUNING`.
- `apps/holtburger-3d/src/lib/frontend-tuning.ts`
  - owns discoverable presentation defaults and immutable quality ceilings.
- `apps/holtburger-3d/src/lib/game/renderer/render-world.ts`
  - `ObjectPresentationFootprint.objectClass` distinguishes Buildings geometry from explicit
    objects and EnvCell residents before draw expansion;
  - `RenderContribution.kind` distinguishes terrain, EnvCell shells, static objects, and dynamics;
  - dynamic presentation bounds and visible rigid contributions are already renderer-queryable;
  - scene queries expose a reused entry buffer, so each outdoor light-frustum query must be fully
    consumed before issuing the next query;
  - indoor grounding can reuse the ordinary view query's already-selected dynamic roots and shells
    instead of issuing one additional broadphase query per EnvCell.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - owns scene selection, contribution expansion, static-submission compilation, flat rendering,
    and portal rendering;
  - dynamic contributions compile to instanced object submissions with source `dynamic`;
  - frame-hot dynamic transforms are grouped into compatible instance runs and uploaded through
    `FrameInstanceStreamArena`; a shadow pass must preserve that batching model;
  - EnvCell-shell submissions retain source `env-cell-shell` and exact authored scope keys;
  - one shell node may contain several material draw units that must share one frame-selected
    grounding-caster set;
  - near and far terrain are selected per landblock at draw time.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-object-program.ts`
  - the vertex shader already computes anchor-relative position and transformed normal;
  - ordinary object variants currently pass only combined lighting, texture coordinates, instance
    color, and optional viewer distance to the fragment stage;
  - a shell-only grounding variant can add position and one up-facing scalar without charging every
    object program.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-terrain-program.ts`
  - already interpolates anchor-relative position and surface normal into the fragment stage;
  - ambient and sun are currently combined and must be separated so PSSM attenuates only sun.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-flat-scene-target.ts` and
  `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-scope-atlas-targets.ts`
  - establish explicit allocation, completeness, resize, and destruction patterns for the outdoor
    PSSM target owner.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-object-state-applicator.ts`
  - owns cached program state and must understand the shell grounding uniforms and independent
    outdoor shadow-pass invalidation.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-transition-snapshot.ts` and
  `apps/holtburger-3d/src/lib/game/renderer/webgl2-flat-scene-presentation.ts`
  - portal traversal retains the already-finished outgoing world as a color-only snapshot and
    composites it with the newly rendered world;
  - shadows therefore require no transition-owned depth or shadow resources, and the authored
    transition tunnel is neither a caster nor a receiver.

### Portal and Spatial Contract

- `docs/portal_rendering.md`
  - EnvCells joined by proven depth-continuous seams form stable visibility islands;
  - portal mode keeps exact authored scopes for selection while routing compatible scopes into one
    render-domain tile;
  - flat mode deliberately collapses presentation into one target, so indoor grounding selection
    must use stable visibility-island facts rather than the synthetic flat render domain.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-scope-atlas-pipeline.ts`
  - routes scope-homogeneous shell submissions without changing their authored scope identity.
- `apps/holtburger-3d/src/lib/game/renderer/dynamic-render-scopes.ts`
  - already resolves plural dynamic scopes to selected visibility-island domains in portal mode.
- `apps/holtburger-3d/src/lib/game/renderer/render-world.ts`
  - exposes scope-selected and flat frustum queries and is the narrow renderer boundary for any
    missing bounds, scope, or visibility-island lookup.
- `apps/holtburger-3d/src/lib/game/runtime/game-presentation-runtime.ts`
  - portal-gated activation installs only ready world content into the scene;
  - renderer feedback names dynamic nodes whose animation presentation must stay current, so nodes
    selected only for outdoor casting or indoor grounding must join that same liveness result.

## North Stars

1. Outdoor PSSM and indoor grounding decals are separate mechanisms because their domains have
   different visibility semantics; do not hide that fact behind a generic shadow framework.
2. Category, outdoor caster eligibility, outdoor receiver eligibility, and each EnvCell's indoor
   candidate set are computed once by the layer that owns the decision and carried explicitly.
3. Indoor grounding is a bounded presentation cue, not simulated light transport. Favor stable,
   cheap, readable blobs over anatomical or physically accurate shadows.
4. The common indoor path performs no sort: zero through eight candidates retain query order;
   nearest-camera ordering exists only to resolve overflow.
5. Indoor work stays inside the existing shell draw. It owns no textures, framebuffers, depth pass,
   receiver attachment, or post-process.
6. Outdoor PSSM attenuates only regional-sun diffuse. Indoor grounding deliberately modulates the
   completed shell material lighting as a stylized contact treatment.
7. Portal and flat rendering consume the same stable visibility-island selection facts; atlas tile
   coordinates never become grounding identity.
8. Outdoor-shadow-only selection participates in the existing renderer-to-animation liveness
   contract; an off-camera caster must not freeze merely because its ordinary color geometry is
   absent. Indoor grounding reuses ordinary visible roots and needs no second liveness path.
9. Disabled means the existing picture and cost path: no outdoor targets or caster queries, no
   indoor candidate construction, and zero grounding iterations.
10. Tuning controls are frontend policy. The renderer receives one validated composite and never
   reads Explorer state directly.

## Accepted Design

### Dynamic Entity Category

Add a serialized `DynamicEntityCategory` with four values:

| Category | Client policy facts | Explorer policy facts | Participates |
| --- | --- | --- | ---: |
| `player` | `ObjectDescriptionFlag::PLAYER` | Explicit player fact only; never guessed from a creature template | Yes |
| `npc` | Creature item type, not attackable, not vendor | Creature-family template, not attackable, not vendor | Yes |
| `mob` | Creature item type, attackable, not vendor | Creature-family template, attackable, not vendor | Yes |
| `other` | Everything else, including vendors | Everything else, including vendors and held children | No |

Each producer mirrors the TUI classifier's precedence using the facts it owns. Classification
helpers stay at the Client and Explorer producer boundaries; the source-neutral projector accepts
the result but owns no classification policy. Serialize the result as
`DynamicEntityView.presentation.category`, then carry it through `DynamicPresentationSource` and
the dynamic `RenderContribution`. TypeScript and renderer consumers never re-derive it. The
category is presentation data, not identity, collision, gameplay, or authoritative world policy.

Explorer resolves category during template preparation and retains it on the app-local
`ExplorerEntityInstance`/projection wrapper, beside rather than inside the source-neutral
`DynamicEntityDefinition`. This is necessary because authored attackability is no longer present
once the shared projection has been formed. Client resolves category in
`project_client_dynamic_entity`, while its live description flags and item type are still present.

Authored radar overrides never change category. Held children and authored-static dynamics are
explicitly `other`.

### Caster and Receiver Matrix

| Presentation | Outdoor PSSM caster | Indoor grounding proxy | Receives |
| --- | ---: | ---: | --- |
| Spawned `player`, `npc`, `mob` | With outdoor scope membership | When eligible for an EnvCell candidate set | No |
| Spawned `other` | No | No | No |
| Authored-static dynamic | No | No | No |
| Portal-transition tunnel | No | No | No |
| Near terrain inside outdoor shadow distance | No | No | Outdoor PSSM |
| Buildings-layer static geometry | No | No | Outdoor PSSM |
| Explicit/Generated outdoor object | No | No | No |
| EnvCell shell | No | No | Indoor grounding |
| EnvCell resident | No | No | No |
| Far terrain outside outdoor shadow distance | No | No | No |

Outdoor receiver eligibility is an explicit renderer submission fact. It is computed from
Buildings publication provenance rather than reconstructed from the broad
`ObjectFrameInput.source = "outdoor"` label.

Indoor receiver eligibility needs no generic receiver enum: only the dedicated EnvCell-shell
program contains grounding code.

### Composite Settings

Add one validated `EntityShadowSettings` value under `FrameSettings`:

```ts
interface EntityShadowSettings {
  /** Master switch for outdoor PSSM and indoor grounding. */
  readonly enabled: boolean;
  readonly outdoor: OutdoorPssmSettings;
  readonly indoor: IndoorGroundingSettings;
}
```

`OutdoorPssmSettings` contains:

- cascade count within one small renderer ceiling;
- square map resolution bounded by baseline WebGL2 guarantees;
- maximum distance, clamped by the camera far plane;
- practical/logarithmic split blend;
- cascade transition fraction;
- constant receiver depth bias;
- normal-offset bias;
- caster polygon-offset factor and units;
- bounded PCF radius;
- shadow strength; and
- light-depth/caster-search padding.

`IndoorGroundingSettings` contains:

- strength;
- entity-radius scale;
- radial softness/spread;
- maximum vertical drop;
- minimum and full-strength up-facing thresholds; and
- an optional small contact bias if source bounds sit exactly on the receiver.

`MAX_INDOOR_GROUNDING_DECALS_PER_ENV_CELL = 8` is an immutable shader/CPU quality ceiling colocated
with the indoor grounding policy. It is not an Explorer setting. The shader source and CPU fixed
storage import the same constant.

Defaults live in `FRONTEND_TUNING`, remain within baseline WebGL2 guarantees, and start enabled.

### Outdoor PSSM

Outdoor PSSM is the only shadow-map family:

- Normalize the existing regional sun direction for light-view construction while preserving its
  original magnitude in regional lighting.
- Use `camera.near` through `min(camera.far, maximumDistance)` as the covered interval.
- Compute practical PSSM splits from the configured uniform/logarithmic blend.
- Reconstruct each camera-frustum slice in the anchor-relative frame.
- Fit and texel-snap one directional orthographic projection per cascade.
- Extend light depth by the configured caster-search padding and produce one light-frustum query
  volume per cascade.
- Retain no canonical or anchor-relative cascade positions across frames.
- Render only visible rigid geometry belonging to spawned `player`, `npc`, and `mob` roots with
  outdoor scope membership.
- Require at least one draw-visible rigid contribution under the existing hidden, `noDraw`, and
  full-translucency rules; category alone never makes an invisible entity cast.
- Build material-free attribute-instanced depth records from the selected rigid contributions,
  group compatible records by cascade/landblock/geometry/index range, and upload through the
  existing frame-instance batching vocabulary rather than issuing one uniform-transform draw per
  part.
- Fully consume each cascade's reused scene-query results before issuing the next query.
- Treat every submitted caster range as opaque depth; do not bind color materials.
- Sample only on near terrain in range and Buildings-layer geometry.
- Multiply only the regional-sun diffuse term by shadow visibility. Ambient, authored/runtime point
  lights, luminosity, material detail, fog, and color grade remain unchanged.
- Skip target allocation, light-frustum queries, caster draws, and samples when disabled or when
  regional sun magnitude is zero.

In portal mode the outdoor map remains an ordinary world-space light map. Outdoor receivers route
through the outdoor atlas tile and sample the same map as flat rendering. Selected indoor scopes do
not admit indoor entities into the outdoor caster set.

### Indoor Grounding Candidate Selection

Represent one indoor grounding proxy as one anchor-relative `vec4`:

```ts
interface IndoorGroundingCaster {
  /** Bottom-center xyz and horizontal presentation radius in render-world units. */
  readonly positionRadius: readonly [number, number, number, number];
}
```

For each visible EnvCell shell, once per frame:

1. Resolve the shell's world bounds and stable visibility-island identity.
2. Build one frame-local indoor candidate pool while consuming the ordinary scope-aware view query:
   retain spawned `player`, `npc`, and `mob` roots only after normal frustum, footprint, hidden,
   `noDraw`, and full-translucency policy leaves at least one visible rigid contribution. Do not
   issue one scene query per cell.
3. Read each pooled caster's current presentation bounds once.
4. Derive each caster's bottom-center, horizontal radius, and short grounding influence bounds.
5. Retain candidates whose influence bounds intersect the cell bounds and whose spatial membership
   includes the same visibility island.
6. If zero through eight candidates survive, preserve their existing query order and perform no
   ordering work.
7. If more than eight survive, retain the eight smallest squared camera distances. Break equal
   distances by GUID so overflow is deterministic. A fixed-size partial selection is sufficient;
   a full sort is not required.
8. Convert the retained records to the current anchor-relative frame once and share the same fixed
   record set across every material draw unit belonging to that EnvCell shell.

Outdoor caster selection unions its retained dynamic node IDs into the frame's existing
`selectedDynamicNodeIds` feedback. Indoor candidates already survived the ordinary view-selection
path and therefore already participate. There is one animation scheduler and one liveness result.

Candidates are selected by influence-volume intersection rather than resident EnvCell alone. An
entity near a depth-continuous cell seam can therefore ground both adjoining shell meshes. Stable
visibility-island equality rejects unrelated overlapping cells in both flat and portal modes.

Nearest-camera overflow is a declared quality budget, not an error. It may omit a farther visible
decal in an unusually crowded cell; that is preferred to unbounded per-fragment work.

### Indoor Shell Shader

Add one shell-only object-program variant rather than charging all object programs:

```ts
type ObjectGroundingMode = "none" | "env-cell-shell";
```

The shell vertex variant carries:

- anchor-relative surface position as `vec3`; and
- one interpolated up-facing weight as `float`, computed from the already-transformed vertex normal.

The shell fragment variant receives:

- `uGroundingCasterCount`;
- `uGroundingCasters[8]` as bottom-center/radius `vec4` records; and
- the validated indoor appearance settings.

For each retained caster, the fragment shader:

1. rejects receiver positions above the caster or beyond maximum drop;
2. evaluates horizontal squared distance without `sqrt`;
3. expands the effective radius modestly with vertical drop;
4. computes a soft radial and height-fade contribution;
5. keeps the strongest contribution rather than adding or multiplying overlaps; and
6. weights the result by the interpolated up-facing factor.

Apply the resulting grounding factor after material/detail modulation and before fog so fog color
is not darkened. A caster count of zero performs one count check and no loop iterations. Disabling
the feature binds count zero and avoids candidate construction.

Fragment evaluation is retained rather than moved to vertices: a decal may lie entirely inside one
large floor triangle and would disappear if only its vertices sampled the blob.

### Portal and Flat Behavior

- Outdoor PSSM is independent of portal-atlas tile coordinates and is sampled only by outdoor
  receivers.
- Indoor grounding executes as part of the ordinary scope-homogeneous EnvCell-shell draw before
  portal composition; it owns no portal pass or atlas resource.
- The exact shell scope remains the draw-routing boundary.
- Stable visibility-island identity controls indoor candidate eligibility in both modes; the
  synthetic flat render domain is never used as grounding identity.
- An entity with plural scopes may become a candidate for cells in each matching visibility island.
- At an exterior portal, outdoor receivers use PSSM and indoor shells use grounding decals. The
  technique transition is intentional and receiver-owned.
- During authored portal traversal, the outgoing color snapshot already contains the shadows from
  its capture frame and the incoming world computes current shadows normally. The tunnel setup
  participates in neither mechanism; no shadow state crosses into the final screen-space blend.
- Same-island structures do not occlude grounding blobs. The short drop/radius bounds and up-facing
  weight limit the artifact; full portal/light transport remains out of scope.

## Phased Implementation

### Phase 1: Explicit Dynamic-Entity Category

#### Deliverables

- Add and document `DynamicEntityCategory` in `holtburger-core` with `Player`, `Npc`, `Mob`, and
  `Other` serialized according to the existing view conventions.
- Add the category to `DynamicEntityPresentationView` and `DynamicEntityViewSource` rather than
  identity, physics, or a nullable side channel. Keep the pure projector policy-free.
- Mirror the TUI classifier's precedence in Client while object-description flags and `ItemType`
  remain available.
- Mirror the same policy in Explorer template preparation using equivalent template facts and
  retain the result on the app-local instance/projection wrapper through delivery.
- Categorize held children and authored-static dynamics explicitly as `other`.
- Carry the required category through the TypeScript schema, presentation adapter,
  `DynamicPresentationSource`, dynamic system, and renderer-facing contribution.

#### Acceptance Criteria

- Every Client and Explorer dynamic view serializes one non-null category.
- Representative player, NPC, mob, vendor, held-child, and ordinary-item fixtures produce the
  intended values.
- Radar color changes cannot change category.
- Existing snapshot/upsert/advance convergence remains unchanged apart from the new stable field.
- The shared definition and projector contain no Client- or Explorer-specific classification
  branch.
- Focused Rust, host, and TypeScript tests pass.

#### Task Checklist

- [ ] Add the category type and view field.
- [ ] Implement producer-local Client classification.
- [ ] Implement producer-local Explorer classification.
- [ ] Carry category through TypeScript runtime and renderer contracts.
- [ ] Add producer, serialization, decode, adapter, and runtime tests.

#### Decisions and Course Corrections

- Pending.

### Phase 2: Composite Policy and Outdoor Cascade Math

#### Deliverables

- Add a focused policy module defining and validating `EntityShadowSettings`,
  `OutdoorPssmSettings`, and `IndoorGroundingSettings`.
- Colocate the documented eight-decal indoor ceiling with its fixed storage and GLSL source
  generation.
- Add default-on conservative values to `FRONTEND_TUNING`.
- Add `FrameSettings.entityShadows` as one complete composite and migrate complete fixtures.
- Add only the missing orthographic/frustum primitives to the existing math vocabulary.
- Add a pure outdoor PSSM module producing split distances, frustum-slice corners, stable light
  fits, light clip matrices, light-frustum queries, and texel sizes into reusable caller storage.

#### Acceptance Criteria

- Invalid nonfinite, unordered, or out-of-range values fail with one reachable failure per message.
- Cascade endpoints exactly cover the configured camera interval and remain strictly ordered.
- Lambda 0, lambda 1, and an intermediate value produce the expected split families.
- Orthographic fits contain all eight slice corners plus caster-depth extension.
- Sub-texel camera motion preserves snapped matrices; crossing a texel boundary changes them by the
  expected quantum.
- Default settings enable both effects; disabled settings remain structurally complete.

#### Task Checklist

- [ ] Define the settings composite and fixed indoor ceiling.
- [ ] Add conservative default-on tuning.
- [ ] Implement missing orthographic/frustum math.
- [ ] Implement stable outdoor cascade construction.
- [ ] Add focused policy and cascade tests.

#### Decisions and Course Corrections

- Pending.

### Phase 3: Outdoor PSSM Targets and Caster Pass

#### Deliverables

- Add `WebGL2PssmShadowTargets` following existing target ownership patterns:
  - one outdoor depth texture array;
  - one reusable depth-only framebuffer with explicit `NONE` draw/read buffers;
  - per-layer attachment and completeness checks;
  - lazy allocation, exact-configuration reuse, transactional replacement, disable disposal, and
    renderer-destroy disposal;
  - one complete fallback depth array for nonreceivers when required by the chosen binding shape.
- Add a focused material-agnostic attribute-instanced dynamic-caster program using
  anchor-relative light clip matrices.
- Add outdoor caster selection that queries each cascade light frustum, requires outdoor spatial
  membership, retains only dynamic contributions, and admits only `player`, `npc`, and `mob` roots.
- Consume each reused query result before the next query, expand selected roots once per cascade,
  omit hidden/`noDraw`/fully transparent geometry, and bind no color material.
- Form compatible depth-instance runs with the existing batching primitives, and union every
  retained caster root into ordinary renderer animation-liveness feedback.
- Upload and draw each cascade's compact instance runs before reusing the frame-instance arena for
  the next cascade; the ordinary color schedule repopulates it afterward. Retain no arena ranges
  across uploads.
- Invalidate cached object state after independent shadow submission.

#### Acceptance Criteria

- Enable, resolution change, cascade-count change, disable, and destroy release every replaced
  resource exactly once.
- Each cascade layer receives only eligible outdoor dynamic geometry.
- Off-camera casters intersecting a light frustum are admitted.
- Off-camera caster animation remains live while it contributes to any cascade.
- Indoor-only and unselected entities never enter outdoor maps.
- Disabled and zero-sun frames perform no target allocation, caster query, material bind, or shadow
  draw.
- Browser shader and target fixtures produce no framebuffer or WebGL errors.

#### Task Checklist

- [ ] Implement the outdoor depth-array target owner.
- [ ] Implement the material-agnostic attribute-instanced caster program and depth-run formation.
- [ ] Implement outdoor scope/category/frustum caster selection.
- [ ] Integrate state invalidation and disabled/zero-sun skips.
- [ ] Add target, selection, shader, and browser fixtures.

#### Decisions and Course Corrections

- Pending.

### Phase 4: Outdoor Receivers

#### Deliverables

- Add bounded PSSM sampling GLSL and typed bindings for terrain and object programs.
- Separate regional-sun diffuse from nondirectional lighting without changing disabled output.
- Add outdoor reception to near terrain:
  - camera-forward cascade selection;
  - bounded PCF, bias, strength, and transition blending;
  - near-program retention for terrain inside maximum shadow distance.
- Project the existing `ObjectPresentationFootprint.objectClass === "building"` fact into one
  explicit receiver bit at static-publication compilation; do not add a second classifier.
- Add PSSM reception to Buildings geometry only; ordinary outdoor objects, Generated scenery,
  dynamics, and EnvCell geometry remain nonreceivers.
- Bind maps, matrices, splits, and settings once per compatible receiver-program group through the
  object state applicator.

#### Acceptance Criteria

- Terrain and Buildings geometry show eligible actor shadows within range.
- Nonreceiver geometry never samples or visibly receives outdoor shadows.
- Outdoor shadowing attenuates only regional-sun diffuse.
- Zero-sun and disabled rendering reproduce existing outdoor lighting.
- Cascade transitions remain visually continuous in deterministic camera sweeps.
- Near/far terrain handoff introduces no uncovered gap inside maximum shadow distance.

#### Task Checklist

- [ ] Add shared outdoor shadow-sampling GLSL and bindings.
- [ ] Separate directional and nondirectional terrain/object lighting terms.
- [ ] Add near-terrain reception and far-terrain policy.
- [ ] Propagate the existing Buildings receiver fact and add sampling.
- [ ] Add shader, receiver-policy, and browser tests.

#### Decisions and Course Corrections

- Pending.

### Phase 5: Indoor Candidate Selection

#### Deliverables

- Add a documented `IndoorGroundingCaster` record and fixed eight-record per-cell result type.
- Add the narrow `RenderWorld` accessors required to read dynamic category, presentation bounds,
  spatial membership, EnvCell bounds, and stable visibility-island identity without exposing
  mutable subsystem state.
- Add a small stateless grounding-volume constructor from presentation bounds and validated indoor
  settings.
- Collect one compact eligible-caster pool while resolving the ordinary view query; reuse it for
  every visible shell rather than issuing per-cell scene queries.
- Add per-visible-EnvCell candidate collection:
  - category filter;
  - existing draw-visibility filter;
  - visibility-island equality;
  - influence-volume/cell-bounds intersection;
  - no ordering for zero through eight candidates;
  - fixed-size nearest-camera partial selection only on overflow;
  - squared distance and GUID tie-break;
  - one anchor-relative record set shared by every shell material draw.
- Keep frame-hot candidate storage caller-owned and reusable.

#### Acceptance Criteria

- Zero through eight candidates retain input order exactly.
- Nine or more candidates return exactly the nearest eight with deterministic GUID ties.
- Ineligible categories, nonintersecting volumes, and different visibility islands are rejected.
- Hidden, `noDraw`, and fully transparent entities produce no grounding record.
- Candidate construction issues no additional scene query per EnvCell.
- One caster intersecting adjacent same-island cells appears in both result sets.
- Overlapping cells from different islands do not share candidates in flat or portal policy tests.
- No candidate work executes while the master switch is disabled.

#### Task Checklist

- [ ] Add fixed indoor caster/result contracts.
- [ ] Add narrow bounds/category/island query accessors.
- [ ] Collect the frame-local indoor candidate pool during ordinary contribution resolution.
- [ ] Implement grounding-volume construction and cell intersection.
- [ ] Implement the common-path pass-through and overflow-only nearest selection.
- [ ] Integrate reusable per-frame/per-cell storage.
- [ ] Add focused selection and coordinate-frame tests.

#### Decisions and Course Corrections

- Pending.

### Phase 6: EnvCell-Shell Grounding Shader

#### Deliverables

- Add a documented shell-only object grounding mode without adding grounding declarations to
  ordinary object variants.
- Carry anchor-relative position and one up-facing scalar from the shell vertex shader.
- Add the fixed eight-record fragment uniform array, count, and indoor appearance uniforms.
- Implement bounded squared-distance grounding evaluation with:
  - vertical rejection and fade;
  - radius scaling/spread;
  - soft radial edge;
  - strongest-overlap composition;
  - up-facing suppression; and
  - application after detail and before fog.
- Bind one cell's record set across all of its shell material draws, using state caching to avoid
  redundant writes when the same values remain active.
- Bind count zero for disabled or empty cells; EnvCell residents retain the ordinary object program.

#### Acceptance Criteria

- A cell with no retained casters is visually identical to existing shell rendering.
- One caster produces a soft bounded grounding patch without feet or model-part facts.
- Height increases softness/spread while fading strength, and maximum drop terminates the effect.
- Vertical and downward-facing surfaces remain substantially unaffected.
- Overlapping decals use the strongest contribution and do not progressively blacken the shell.
- Eight records compile and execute within baseline WebGL2 fragment-uniform limits.
- Shell alpha discard, detail, baked/runtime lighting, fog, culling, and portal routing remain intact.
- EnvCell residents and outdoor object programs contain no grounding loop or uniforms.

#### Task Checklist

- [ ] Add the shell-only program option and varyings.
- [ ] Add fixed grounding uniforms and state application.
- [ ] Implement the bounded analytic fragment helper.
- [ ] Associate one per-cell record set with every shell material draw.
- [ ] Add shader-source, state-cache, flat, portal, and browser fixtures.

#### Decisions and Course Corrections

- Pending.

### Phase 7: Explorer Controls and Mixed-Domain Integration

#### Deliverables

- Add Explorer Render controls for:
  - master enable;
  - outdoor cascade count, resolution, maximum distance, split lambda, blend fraction, PCF radius,
    strength, biases, and caster-depth padding;
  - indoor strength, radius scale, softness/spread, maximum drop, up-facing thresholds, and contact
    bias.
- Update `ExplorerApp.svelte` through one composite update and pass one complete value through
  `ExplorerWorldPanel.svelte`; do not create one unrelated top-level state field per control.
- Add matching browser-harness overrides and emit the complete effective settings for reproducible
  captures.
- Integrate one frame schedule where outdoor PSSM and indoor shell grounding may both be visible
  through an exterior portal without sharing resources or receiver policy.
- Preserve portal-transition ownership: outgoing snapshots capture the completed shaded picture,
  incoming scenes compute current effects, and the transition tunnel uses neither path.
- Verify toggle/reconfigure lifecycle and object-state invalidation across flat, portal, SAO,
  blended, particle, and presentation work.

#### Acceptance Criteria

- Explorer initializes with default-on settings.
- Every control updates the next frame without rebuilding world content.
- Invalid contracts fail before reaching shader/resource code.
- Disabling releases outdoor PSSM targets, skips both selection paths, binds zero indoor casters,
  and restores the pre-feature picture.
- Re-enabling allocates one valid outdoor generation and resumes both effects without stale data.
- Outdoor and indoor effects coexist across a portal without atlas-coordinate seams or cross-domain
  receiver mistakes.
- Portal traversal blends a frozen outgoing shaded frame with a currently shaded incoming frame;
  it allocates no transition-specific shadow resource and the tunnel casts/receives neither effect.
- Harness output is sufficient to reproduce a visual configuration.

#### Task Checklist

- [ ] Add composite Explorer state and controls.
- [ ] Add harness overrides and effective-setting output.
- [ ] Integrate the mixed outdoor/indoor frame schedule.
- [ ] Add toggle/reconfigure and mixed-portal coverage.

#### Decisions and Course Corrections

- Pending.

### Phase 8: Final Visual Review, Cleanup, and Verification

#### Deliverables

- Review actual sLOC, shader variants, state transitions, and resource ownership; collapse any
  abstraction serving only one trivial call.
- Capture deterministic visual cases for:
  - player/NPC/mob participation and `other` exclusion;
  - outdoor terrain and Buildings reception;
  - outdoor cascade transitions, shallow sun, noon, and zero sun;
  - indoor one, eight, and overflow caster cells;
  - same-island cell seams and different-island overlap;
  - shell reception beside resident nonreception;
  - flat, portal, indoor-to-outdoor, and outdoor-to-indoor views;
  - entering/waiting/exiting portal-transition snapshots and the authored tunnel;
  - master enable/disable equivalence.
- Tune outdoor PSSM and indoor grounding defaults from captures.
- Present the default-on result for the user's final keep/remove decision; profiling is not an
  acceptance gate.
- Sweep obsolete universal-shadow, interior-light, receiver-attachment, and indoor-shadow-map
  terminology from code, fixtures, UI, and documentation.
- Update `docs/lighting.md` with outdoor directional shadows and stylized indoor grounding.
- Update `docs/portal_rendering.md` with the receiver-owned technique boundary, outdoor world-space
  lookup, and visibility-island indoor candidate policy.
- Update this plan's status, checklists, decisions, and deferred debt.

#### Acceptance Criteria

- The user has accepted the tuned default-on result or chosen to remove one or both effects.
- No unacceptable outdoor acne, detached shadows, cascade seams, or camera shimmer remains at
  accepted defaults.
- Indoor decals ground entities without obvious cell-grid seams, wall smearing, progressive crowd
  blackening, or unstable overflow selection.
- Every caster and receiver class matches the matrix in this plan.
- `npm run format:check`, `npm run check`, `npm run lint`, and `npm run test:ts` pass from
  `apps/holtburger-3d`.
- `cargo test -p holtburger-core -p holtburger-3d-host` passes.
- `cargo clippy -p holtburger-core -p holtburger-3d-host --all-targets -- -D warnings` passes.
- Browser-harness fixtures pass without browser, shader-link, framebuffer, or WebGL errors.
- Renderer destruction and enable/disable/reconfigure cycles leak no outdoor shadow resources.
- Documentation describes the implementation that landed rather than the discarded universal-PSSM
  proposal.

#### Task Checklist

- [ ] Perform the architecture and sLOC resteer.
- [ ] Run the complete visual matrix and tune defaults.
- [ ] Record the user's keep/remove decision and remaining debt.
- [ ] Collapse accidental abstractions and sweep stale vocabulary.
- [ ] Update lighting and portal documentation.
- [ ] Run Rust, TypeScript, Svelte, lint, format, and browser verification.
- [ ] Complete this plan's execution record.

#### Decisions and Course Corrections

- Pending.

## Risks and Mitigations

| Risk | Consequence | Mitigation |
| --- | --- | --- |
| Client and Explorer category implementations drift | Equivalent actors participate differently | Mirror the TUI precedence in focused producer functions, carry one resolved enum, and cover representative fixtures |
| Outdoor caster alpha is ignored | Hair or clothing can cast solid silhouettes | Accept the first-version tradeoff and keep the depth pass material-free |
| Off-camera outdoor casters are omitted | Shadows pop at screen edges | Query cascade light frusta rather than reuse camera-visible dynamic submissions |
| Outdoor-shadow-only dynamic animation is not retained | An off-camera cast silhouette freezes | Union outdoor caster roots into the existing renderer animation-liveness feedback; indoor candidates already use visible roots |
| Reused scene-query entries are overwritten | A later cascade query corrupts an earlier caster set | Fully consume each query before issuing another; retain only owned compact caster records |
| Depth submission bypasses frame-instance batching | Crowds multiply caster draw calls and transform uploads | Use an attribute-instanced depth program and the existing compatible-run/arena vocabulary |
| Indoor selection queries once per cell | Cell-grid rooms repeat broadphase work | Collect eligible dynamic roots once from the ordinary view query and intersect the compact pool against visible shells |
| PSSM state corrupts later portal/object draws | Subsequent passes render incorrectly | Restore explicit framebuffer/viewport state and invalidate cached object routing after shadow submission |
| Cascade matrices swim | Distracting outdoor shimmer | Use stable fits, texel snapping, deterministic camera sweeps, and final screenshot review |
| Bias tuning detaches outdoor shadows | Peter-panning | Keep constant, normal, and polygon-offset controls separate and bounded |
| Far-terrain optimization overlaps shadow coverage | Visible terrain shadow gap | Keep terrain inside maximum distance on the shadow-capable near path |
| Grounding code bloats every object shader | Nonreceiver cost and variant sprawl | Compile one shell-only grounding option; ordinary programs contain no grounding declarations |
| A decal lies inside one large floor triangle | Vertex-only evaluation misses it | Evaluate the radial function per fragment and interpolate only position/up-facing weight |
| A cell has more than eight eligible candidates | A farther visible decal is omitted | Invoke deterministic nearest-camera partial selection only on overflow; treat omission as the declared quality budget |
| Common cells pay unnecessary sorting cost | Frame-hot CPU overhead grows for no visual benefit | Preserve candidate order and skip all ordering work at counts zero through eight |
| Cell-grid room seams split a blob | Grounding pops at invisible EnvCell boundaries | Select by influence-volume/cell intersection across same-island cells rather than resident scope alone |
| Overlapping cells contaminate grounding | A caster grounds an unrelated stacked shell | Require stable visibility-island equality and bound vertical drop/radius |
| Same-island structures do not occlude blobs | A short decal can reach a nearby unintended floor | Keep the effect short, suppress non-upward surfaces, and accept that it is grounding rather than light transport |
| Crowds blacken the floor | Overlapping decals look like soot | Combine by strongest contribution rather than addition or multiplication |
| Presentation bounds make a poor footprint | Some entity blobs are too large or small | Use bounded radius scaling and tune from representative visual cases; do not add anatomy heuristics |
| Repeated shell material draws rewrite identical uniforms | CPU submission work grows | Compute one cell record set and let the object-state cache suppress identical consecutive writes |
| Disable leaves work or resources active | Toggle does not restore baseline | Gate both selection paths from the master policy, bind indoor count zero, and release outdoor targets |
| Portal transition invents a second shadow lifecycle | Snapshot/tunnel resources become tangled with world shading | Keep effects inside ordinary scene rendering; outgoing color is already shaded and the tunnel is excluded |

## Definition of Done

- [ ] Every dynamic frontend view carries one explicit `player`, `npc`, `mob`, or `other` category.
- [ ] Category is serialized as presentation policy, resolved before the source-neutral projector,
  and never reconstructed from radar color.
- [ ] Only spawned players/NPCs/mobs participate in either effect.
- [ ] Outdoor actor geometry casts material-agnostic PSSM shadows only onto terrain in range and
  Buildings-layer geometry.
- [ ] Outdoor PSSM attenuates regional-sun diffuse without altering ambient, point, baked, detail,
  fog, luminosity, or color-grade terms.
- [ ] EnvCell shells evaluate at most eight analytic grounding decals; residents and other object
  programs contain no grounding work.
- [ ] Indoor candidate counts zero through eight preserve order; overflow deterministically keeps
  the nearest eight by squared camera distance and GUID tie-break.
- [ ] Same-island adjacent cells share intersecting decals while different-island overlapping cells
  do not.
- [ ] Outdoor-shadow-only dynamic roots keep their existing animation presentation live; indoor
  grounding adds no separate animation-liveness path.
- [ ] Flat and portal rendering honor the same indoor selection facts and outdoor world-space maps.
- [ ] Portal-transition snapshots contain the capture frame's completed shading, incoming shading
  remains live, and transition tunnel geometry participates in neither effect.
- [ ] The master switch and all supported appearance parameters are live in Explorer and default on.
- [ ] Disabled mode allocates no outdoor targets, performs no caster/candidate work, binds no indoor
  decals, and reproduces the pre-feature picture.
- [ ] Category, settings, cascade math, target lifecycle, caster/receiver, indoor selection, shader,
  scope, toggle, and browser tests pass.
- [ ] Final visual review tunes defaults and records the user's keep/remove decision.
- [ ] Lighting, portal documentation, and this plan describe the hybrid implementation and accepted
  limitations.

## Open Questions

None block implementation. Exact outdoor and indoor appearance defaults, plus the user's final
keep/remove decision for each effect, are deferred to Phase 8.
