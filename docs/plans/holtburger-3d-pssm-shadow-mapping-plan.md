# Holtburger 3D Hybrid Entity Shadowing Plan

Status: Complete (Phases 1-10 accepted and verified)
Created: 2026-08-26
Resteered: 2026-08-28
Revalidated against `3d-next`: 2026-08-28 (`68e65e46`)

## Context and Boundaries

### Goal

Ground spawned players, NPCs, and mobs through an explicit quality mode: no shadows, cheap analytic
grounding on outdoor terrain and EnvCell shells, or outdoor PSSM on terrain/Buildings paired with
the same indoor analytic grounding.

### In Scope

- A producer-resolved dynamic-entity presentation category with the narrow values `player`, `npc`,
  `mob`, and `other`.
- Shadow participation only by spawned dynamic entities categorized as player, NPC, or mob.
- Outdoor PSSM:
  - regional sun direction;
  - material-agnostic opaque caster geometry;
  - terrain inside the configured shadow distance and Buildings-layer geometry as receivers;
  - stable cascades, bounded PCF, cascade blending, and tunable bias.
- Outdoor simple grounding:
  - near terrain as the only receiver;
  - the same root-stable, pose-reactive analytic caster record and fragment evaluator used indoors;
  - at most eight grounding casters per visible terrain landblock, with sorting only on overflow;
  - no caster geometry, texture, framebuffer, or separate rendering pass.
- Indoor analytic grounding:
  - EnvCell shells as the only receivers;
  - authoritative entity-root height as the stable vertical contact anchor;
  - current rigid-pose horizontal bounds as the animation-reactive center and radius;
  - no particle or temporary-effect envelope in either grounding fact;
  - at most eight grounding casters per visible EnvCell;
  - a cheap squared-distance fragment calculation inside a shell-only object-program variant;
  - visibility-island and influence-volume filtering so cell-grid rooms remain continuous without
    admitting unrelated stacked cells.
- Flat and portal rendering.
- One default-`shadow-maps` Explorer mode selector with `none`, `simple`, and `shadow-maps` levels,
  plus live controls for the tunable PSSM and analytic-grounding appearance parameters.
- Focused pure, shader, target-lifecycle, and browser-harness verification.

### Out of Scope

- Universal PSSM or one collapsed indoor/outdoor visibility policy.
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
- Profiling or hardware-performance acceptance gates. Final tuning and three-mode acceptance are
  user-owned visual-review decisions.
- Investigating retail shadow code paths or adding retail compatibility markers for this feature.
- Modifying `acclient-eor-source`.

## Ground Truth

### User Decisions

- Only spawned players, NPCs, and mobs participate; all other dynamic and authored-static entities
  do not.
- Classification is an explicit category computed while producer facts are available. Radar color
  is not classification input.
- The minimap's proven semantic classifier is the policy reference. Its color-independent category
  decision is shared by the 3D Client, Explorer, and radar fallback coloring; rendered radar color
  remains presentation output rather than classification input.
- Outdoor PSSM receivers are terrain and Buildings-layer geometry; simple analytic outdoor
  grounding is terrain-only.
- “Cell structures” means EnvCell shell geometry, not EnvCell residents.
- Shadow quality has three exhaustive levels: `none`; `simple`, using analytic grounding indoors
  and on outdoor terrain; and `shadow-maps`, using PSSM outdoors plus analytic grounding indoors.
- Indoor grounding makes no assumption that an entity has feet or that any model part represents
  contact with the floor.
- Indoor grounding keeps animation-reactive horizontal size and center, but animation never changes
  its vertical contact anchor. The entity root moves that anchor for authoritative translation,
  jumping, falling, and relocation.
- Particle envelopes and temporary effects never resize or reposition an indoor grounding decal.
- Indoor decals are evaluated by the EnvCell-shell shader rather than by a receiver attachment or
  post-process.
- Each EnvCell evaluates at most eight candidate decals.
- Candidate ordering is untouched when eight or fewer candidates survive. Only overflow invokes
  nearest-camera selection, using squared distance and GUID as a stable tie-breaker.
- Shadows default to `shadow-maps`. Appearance defaults are provisional and are tuned during final
  visual review.
- Baseline WebGL2 is the target; no separate capability-discovery or browser-matrix phase is needed.

### Current Entity Contract

- `crates/holtburger-core/src/dynamic_entity.rs`
  - owns the shared color-independent `DynamicEntityCategory` and the live/Explorer adapters from
    their respective available facts;
  - the existing `semantic_radar_blip_color` and `explorer_radar_blip_color` functions consume the
    same category decision before handling nonactor radar classes;
  - vendors are category `npc`, matching their friendly-green semantic radar presentation; authored
    radar overrides never affect category.

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
  - the existing dynamic footprint uses current presentation bounds expanded by the particle
    envelope, so grounding must receive a narrower producer-owned rigid-pose horizontal fact rather
    than reusing that culling/presentation contract;
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

1. PSSM and analytic grounding are separate mechanisms. Share the grounding primitive across
   domains, but keep outdoor landblock and indoor visibility-island selection explicit.
2. Category, outdoor caster eligibility, outdoor receiver eligibility, and each EnvCell's indoor
   candidate set are computed once by the layer that owns the decision and carried explicitly.
3. Analytic grounding is a bounded presentation cue, not simulated light transport. Favor stable,
   cheap, readable contact while preserving useful horizontal response to animation.
4. The common analytic path performs no sort through the configured per-receiver capacity (eight
   by default); nearest-camera ordering exists only to resolve overflow.
5. Analytic work stays inside existing terrain or shell draws. It owns no textures, framebuffers,
   depth pass, receiver attachment, post-process, or per-caster geometry.
6. Outdoor PSSM attenuates only regional-sun diffuse. Analytic grounding deliberately modulates the
   completed receiver lighting as a stylized contact treatment.
7. Portal and flat rendering consume the same stable visibility-island selection facts; atlas tile
   coordinates never become grounding identity.
8. Outdoor-shadow-only selection participates in the existing renderer-to-animation liveness
   contract; an off-camera caster must not freeze merely because its ordinary color geometry is
   absent. Indoor grounding reuses ordinary visible roots and needs no second liveness path.
9. `none` means the existing picture and cost path: no outdoor targets or caster queries, no
   analytic candidate construction, and no grounding receiver variants.
10. Tuning controls are frontend policy. The renderer receives one validated composite and never
    reads Explorer state directly.

## Accepted Design

### Dynamic Entity Category

Add a serialized `DynamicEntityCategory` with four values:

| Category | Client policy facts                              | Explorer policy facts                                             | Participates |
| -------- | ------------------------------------------------ | ----------------------------------------------------------------- | -----------: |
| `player` | `ObjectDescriptionFlag::PLAYER`                  | Explicit player fact only; never guessed from a creature template |          Yes |
| `npc`    | Vendor, or creature item type without attackable | Vendor, friendly special type, or nonattackable creature family   |          Yes |
| `mob`    | Attackable creature item type, excluding vendors | Attackable creature-family template, excluding vendors            |          Yes |
| `other`  | Everything else                                  | Everything else, including held children                          |           No |

The shared `holtburger-core` semantic classifier mirrors the minimap's player, creature,
attackable, and vendor precedence through two fact adapters: live object-description facts for
Client and static template facts for Explorer. Producer boundaries call the appropriate adapter;
the source-neutral projector accepts the result but owns no classification policy. Serialize it as
`DynamicEntityView.presentation.category`, then carry it through `DynamicPresentationSource` and
the dynamic `RenderContribution`. TypeScript and renderer consumers never re-derive it. The
category is presentation data, not identity, collision, gameplay, or authoritative world policy.

Explorer resolves category during template preparation and retains it on the app-local
`ExplorerEntityInstance`/projection wrapper, beside rather than inside the source-neutral
`DynamicEntityDefinition`. This is necessary because authored attackability is no longer present
once the shared projection has been formed. Client resolves category in
`project_client_dynamic_entity`, while its live description flags and item type are still present.
The shared category helper is also the first branch in radar fallback color selection; the final
color is never fed back into classification.

Authored radar overrides never change category. Held children and authored-static dynamics are
explicitly `other`.

### Caster and Receiver Matrix

| Presentation                               |           Outdoor PSSM caster |                              Analytic grounding proxy | Receives                                    |
| ------------------------------------------ | ----------------------------: | ----------------------------------------------------: | ------------------------------------------- |
| Spawned `player`, `npc`, `mob`             | With outdoor scope membership | When eligible for an outdoor or EnvCell candidate set | No                                          |
| Spawned `other`                            |                            No |                                                    No | No                                          |
| Authored-static dynamic                    |                            No |                                                    No | No                                          |
| Portal-transition tunnel                   |                            No |                                                    No | No                                          |
| Near terrain inside active effect coverage |                            No |                                                    No | Outdoor PSSM or simple analytic grounding   |
| Buildings-layer static geometry            |                            No |                                                    No | Outdoor PSSM only                           |
| Explicit/Generated outdoor object          |                            No |                                                    No | No                                          |
| EnvCell shell                              |                            No |                                                    No | Analytic grounding in both non-`none` modes |
| EnvCell resident                           |                            No |                                                    No | No                                          |
| Far terrain outside active effect coverage |                            No |                                                    No | No                                          |

Outdoor receiver eligibility is an explicit renderer submission fact. It is computed from
Buildings publication provenance rather than reconstructed from the broad
`ObjectFrameInput.source = "outdoor"` label.

Indoor receiver eligibility needs no generic receiver enum: only the dedicated EnvCell-shell
program contains grounding code.

Simple outdoor grounding is terrain-only. Buildings, other outdoor objects, and far terrain never
compile or evaluate analytic grounding; Buildings retain their existing PSSM-only receiver fact.

### Composite Settings

Add one validated `EntityShadowSettings` value under `FrameSettings`:

```ts
interface EntityShadowSettings {
  readonly mode: "none" | "simple" | "shadow-maps";
  readonly pssm: OutdoorPssmSettings;
  readonly grounding: EntityGroundingSettings;
}
```

Mode semantics are exhaustive and renderer-owned:

- `none`: no PSSM pass, analytic candidate selection, receiver variant, or retained depth target;
- `simple`: analytic grounding on outdoor near terrain and EnvCell shells, with no PSSM work or
  retained depth target; and
- `shadow-maps`: outdoor PSSM on terrain and Buildings plus analytic grounding on EnvCell shells.

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

`EntityGroundingSettings` contains:

- strength;
- entity-radius scale;
- radial softness/spread;
- maximum vertical drop;
- minimum and full-strength up-facing thresholds; and
- an optional small contact bias if source bounds sit exactly on the receiver.

`maximumGroundingCastersPerReceiver` is a build-time frontend-tuning value (eight by default) with
a baseline-WebGL2 ceiling of 32. It sizes the shared shader constant, CPU record storage, and
overflow selection for one EnvCell shell or outdoor terrain landblock; it is deliberately not a
runtime Explorer control.

Defaults live in `FRONTEND_TUNING`, remain within baseline WebGL2 guarantees, and start in
`shadow-maps` mode.

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

Represent each selected grounding proxy on the GPU as one anchor-relative `vec4`:

```ts
interface EntityGroundingRecord {
  /** Animated horizontal center, stable root-contact y, and animated rigid radius. */
  readonly positionRadius: readonly [number, number, number, number];
}
```

For each visible EnvCell shell, once per frame:

1. Resolve the shell's world bounds and stable visibility-island identity.
2. Build one frame-local indoor candidate pool while consuming the ordinary scope-aware view query:
   retain spawned `player`, `npc`, and `mob` roots only after normal frustum, footprint, hidden,
   `noDraw`, and full-translucency policy leaves at least one visible rigid contribution. Do not
   issue one scene query per cell.
3. Read each pooled caster's producer-owned grounding facts once: current rigid-pose horizontal
   bounds before particle expansion, plus its existing authoritative root placement.
4. Transform the current rigid bounds by the root placement, derive animated X/Z center and radius,
   and take contact Y from the root origin rather than any current or default-pose mesh minimum.
   Build the short grounding influence bounds from that composite anchor.
5. Retain candidates whose influence bounds intersect the cell bounds and whose spatial membership
   includes the same visibility island.
6. If no more than the configured per-receiver capacity survive, preserve their existing query
   order and perform no ordering work.
7. On overflow, retain the configured number with the smallest squared camera distances. Break
   equal distances by GUID so overflow is deterministic. A fixed-size partial selection is
   sufficient; a full sort is not required.
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
- `uGroundingCasters[MAX_ENTITY_GROUNDING_CASTERS]` as contact-anchor/radius `vec4` records; and
- the validated indoor appearance settings.

For each retained caster, the fragment shader:

1. rejects receiver positions above the caster or beyond maximum drop;
2. evaluates horizontal squared distance without `sqrt`;
3. expands the effective radius modestly with vertical drop;
4. computes a soft radial and height-fade contribution;
5. keeps the strongest contribution rather than adding or multiplying overlaps; and
6. weights the result by the interpolated up-facing factor.

The horizontal footprint deliberately remains pose-reactive: a wide attack or crouch may change
its center and radius. Its Y component is deliberately not pose-reactive: limbs, robes, authored
root animation, and particle envelopes cannot push the contact anchor below a receiver and make the
decal disappear. Authoritative root movement still raises or lowers the anchor, so jumping and
falling continue to spread and fade through the existing drop calculation.

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
- Reuse the minimap's semantic precedence in Client while object-description flags and `ItemType`
  remain available.
- Reuse the same color-independent semantic policy in Explorer template preparation using
  equivalent template facts and retain the result on the app-local instance/projection wrapper
  through delivery.
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

- [x] Add the category type and view field.
- [x] Implement shared semantic classification with Client and Explorer fact adapters.
- [x] Retain Explorer category through its app-local prepared-instance/projection wrapper.
- [x] Carry category through TypeScript runtime and renderer contracts.
- [x] Add producer, serialization, decode, adapter, and runtime tests.

#### Decisions and Course Corrections

- The initial implementation duplicated the minimap's creature/attackable/vendor policy in private
  Client and Explorer functions. Review found the established classifiers already in
  `holtburger-core::dynamic_entity`; Phase 1 was corrected before acceptance to extract one shared,
  color-independent category decision used by both radar fallback coloring and shadow policy.
- Category cannot be derived from the final radar color: authored radar colors may override the
  semantic fallback, and a nonactor may author the same bright green used by friendly NPCs.
- User review identified WCID 702, Shopkeep Mirinda, as an NPC that produced no shadow. A catalog
  probe proved its template is `WeenieType::Vendor`; both producer adapters still carried a legacy
  rule forcing vendors to `other`. Vendors now resolve to `npc` before attackability, matching their
  friendly semantic radar treatment and admitting both Explorer-spawned and live vendors through
  the existing NPC shadow policy.
- ACE's `WorldObject.Attackable` defaults to true when absent, so generic Explorer creature
  templates use `unwrap_or(true)`. Admin and Sentinel preserve the minimap's explicit friendly
  classification instead of inheriting that default.
- `DynamicEntityCategory` is serialized under `presentation`; the shared projector only transports
  it. Explorer retains it outside `DynamicEntityDefinition` because it is presentation policy, not
  reusable content identity or physics.
- Held children, authored-static dynamics, and portal-transition dynamics are explicitly `other`.
- Phase acceptance evidence: Rust checks and Clippy passed; all 215 TypeScript test files (1,606
  tests), Svelte/TypeScript checks, and focused Client/Explorer category/projection tests passed.

### Phase 2: Composite Policy and Outdoor Cascade Math

#### Deliverables

- Add a focused policy module defining and validating `EntityShadowSettings`,
  `OutdoorPssmSettings`, and `EntityGroundingSettings`.
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

- [x] Define the settings composite and fixed indoor ceiling.
- [x] Add conservative default-on tuning.
- [x] Implement missing orthographic/frustum math.
- [x] Implement stable outdoor cascade construction.
- [x] Add focused policy and cascade tests.

#### Decisions and Course Corrections

- Added one validated `EntityShadowSettings` composite to `FrameSettings`; disabled settings retain
  complete outdoor and indoor values. Validation runs before renderer resource or shader work.
- Fixed renderer ceilings are four cascades, a 2048-square depth array, radius-two PCF, and eight
  indoor grounding records. The first provisional default is three 1024-square cascades covering
  384 world units; all appearance values remain explicitly deferred to final visual tuning.
- Cascade fits use a camera-slice bounding sphere rather than a tight light-space AABB. This spends
  some map area to keep the square footprint invariant under camera rotation. A one-texel guard
  band contains the at-most-half-texel snapped-center displacement.
- Successor cascades extend their fitted near edge back to the predecessor's transition start.
  Nominal split endpoints remain strictly ordered for receiver selection, while the explicit
  `coverageNear` overlap makes transition sampling valid instead of reading beyond the successor
  map.
- Caster-search padding extends light depth only toward the sun. Extending behind the receiving
  camera slice would admit geometry that cannot cast onto that slice.
- Orthographic matrix construction, frustum extraction, cascade records, corner arrays, matrices,
  and frusta accept/reuse caller-owned storage. No anchor-relative cascade value is retained across
  frames by the policy module itself.
- Phase acceptance evidence: focused policy/matrix/frustum/cascade tests passed; the complete 217
  TypeScript test files (1,638 tests), app checks, app lint/dead-export checks, Rust tests, and
  Clippy passed after Phases 1-2.

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

- [x] Implement the outdoor depth-array target owner.
- [x] Implement the material-agnostic attribute-instanced caster program and depth-run formation.
- [x] Implement outdoor scope/category/frustum caster selection.
- [x] Integrate state invalidation and disabled/zero-sun skips.
- [x] Add target, selection, shader, and browser fixtures.

#### Decisions and Course Corrections

- Added one `WebGL2OutdoorPssmPass` owner around the target, lazy caster program, cascade scratch,
  selection scratch, and sequential instance upload/draw schedule. `WebGL2Renderer` owns only the
  per-view call site and object-state invalidation, rather than absorbing another independent GL
  state machine.
- The target is one `DEPTH_COMPONENT24` `TEXTURE_2D_ARRAY` plus one framebuffer whose attached
  layer changes per cascade. Allocation validates both device limits, checks every layer, replaces
  generations transactionally, and restores array-texture plus draw/read framebuffer bindings.
- No fallback depth texture was added. The chosen receiver contract in Phase 4 will use an explicit
  active/inactive program binding, so nonreceivers and inactive frames never need a sampleable
  placeholder solely to make a uniform shape total.
- Caster selection issues an outdoor-scope query filtered to the dynamic producer group for each
  exact light frustum. It fully copies eligible visible rigid parts before the next query, rechecks
  part-level outdoor membership, and adds a root to animation liveness only after a part survives.
- The caster program ignores material/color attributes and alpha while preserving the draw unit's
  effective front/back face rejection. Cull face is therefore part of exact run compatibility, but
  no material texture, sampler, alpha test, luminosity, or color modulation enters the pass.
- Compatible parts group by landblock, resolved geometry, index range, and cull face through the
  existing grouped-instance primitive. Each cascade repopulates the shared frame-instance arena;
  no range survives the next upload or the ordinary color schedule.
- Disabled frames synchronously release the active target generation and skip the per-view pass.
  Zero-sun or empty camera-coverage intervals return before target allocation, scene query, shader
  compilation, or GL state changes. A previously allocated generation may remain resident across a
  temporary zero-sun frame, but is inactive and unsampled; this avoids a dusk/dawn allocation churn
  not required by the disabled lifecycle contract.
- Shadow submission restores the default framebuffer, drawing-buffer viewport, color mask, array
  binding, polygon-offset state, and culling state, then invalidates the independent object-state
  cache before ordinary rendering.
- The production browser fixture compiles the caster shader and validates every layer across a
  256x2 generation and a replacement 512x3 generation. It also proves exact reuse and disposal
  diagnostics. The headless baseline-WebGL2 run passed with no browser-console or GL errors.
- Phase acceptance evidence: all 221 TypeScript test files (1,654 tests), complete app checks,
  TypeScript lint, dead-export checks, formatting, focused target/selection/pass/shader tests, and
  the `outdoor-pssm` browser fixture passed.

#### Debt Carried Forward

- Outdoor target bytes, cascade queries, retained roots/parts/runs, and submitted draw/instance
  counts are intentionally not widened into the public frame metric contract until the Phase 6
  diagnostics work gives each field a named Explorer consumer.

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

- [x] Add shared outdoor shadow-sampling GLSL and bindings.
- [x] Separate directional and nondirectional terrain/object lighting terms.
- [x] Add near-terrain reception and far-terrain policy.
- [x] Propagate the existing Buildings receiver fact and add sampling.
- [x] Add shader, receiver-policy, and browser tests.

#### Decisions and Course Corrections

- Added one bounded receiver GLSL module shared by terrain and object variants. It uses one
  comparison-sampler depth array on texture unit 7, camera-forward cascade selection, radius-two
  compile-time PCF bounds, configured inner radius, normal/depth bias, strength, and successor-map
  transition blending.
- Existing programs remain the inactive/nonreceiver path. Receiver variants are compiled lazily
  only after an active outdoor shadow frame exists, so disabled and zero-sun frames preserve the
  prior shader and lighting path without a dummy depth texture.
- Scene-lighting GLSL now exposes ambient and regional-sun terms separately. Receiver variants
  interpolate both the complete lighting value and its no-sun counterpart, then apply shadow
  visibility only between those values. Baked light, runtime point lights, ambient, material
  modulation, luminosity, and fog remain outside shadow attenuation.
- Buildings reception is one explicit bit computed at static-publication compilation by the named
  `isOutdoorPssmReceiverFootprint` policy. The draw loop consumes that bit and does not reclassify
  objects. Explicit objects, Generated scenery, dynamics, EnvCell shells/residents, and portal
  transition geometry remain on ordinary programs.
- Terrain landblocks whose horizontal AABB intersects maximum shadow distance are conservatively
  retained on the near receiver program even when the normal far-terrain cutoff would select the
  nonreceiving far shader. The pure intersection policy has boundary and out-of-range tests.
- Portal-composited outdoor Buildings use portal-visibility receiver variants but sample the same
  anchor-relative world-space cascade maps as flat rendering; no atlas-coordinate or portal-owned
  shadow state was added.
- The terrain receiver source is derived from the existing validated terrain shader with
  fail-loud required-section replacement. This avoids maintaining a duplicated large shader. A
  second feature requiring similar source transformation should trigger a small shader-composition
  refactor rather than another replacement layer.
- The browser fixture now links terrain plus all six baked/instanced, opaque/blended, and
  portal/non-portal object receiver variants in baseline WebGL2. Every program linked and the
  production Buildings receiver path rendered with no browser-console or GL errors.
- Phase acceptance evidence: all 223 TypeScript test files (1,663 tests), complete app checks,
  terrain-shader validation, TypeScript lint, dead-export checks, formatting, focused policy/state/
  shader tests, and the `outdoor-pssm` browser fixture passed. Cascade appearance and final defaults
  remain part of the user-owned Phase 10 visual review rather than an automated visual-quality gate.

### Phase 5: Indoor Candidate Selection

#### Deliverables

- Add a documented entity-grounding caster record and fixed-capacity per-cell result type, sized
  from frontend tuning with a default capacity of eight.
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
  - no ordering through the configured per-receiver capacity;
  - fixed-size nearest-camera partial selection only on overflow;
  - squared distance and GUID tie-break;
  - one anchor-relative record set shared by every shell material draw.
- Keep frame-hot candidate storage caller-owned and reusable.

#### Acceptance Criteria

- Candidates through the configured capacity retain input order exactly.
- Overflow returns exactly the configured nearest candidates with deterministic GUID ties.
- Ineligible categories, nonintersecting volumes, and different visibility islands are rejected.
- Hidden, `noDraw`, and fully transparent entities produce no grounding record.
- Candidate construction issues no additional scene query per EnvCell.
- One caster intersecting adjacent same-island cells appears in both result sets.
- Overlapping cells from different islands do not share candidates in flat or portal policy tests.
- No candidate work executes while the master switch is disabled.

#### Task Checklist

- [x] Add fixed indoor caster/result contracts.
- [x] Add narrow bounds/category/island query accessors.
- [x] Collect the frame-local indoor candidate pool during ordinary contribution resolution.
- [x] Implement grounding-volume construction and cell intersection.
- [x] Implement the common-path pass-through and overflow-only nearest selection.
- [x] Integrate reusable per-frame/per-cell storage.
- [x] Add focused selection and coordinate-frame tests.

#### Decisions and Course Corrections

- Added one pure indoor-grounding module with documented world-space caster/cell records, a fixed
  8x`vec4` GPU-ready result, and caller-owned eligible/nearest scratch. The category gate consumes
  the same shared actor-caster policy as outdoor PSSM.
- A candidate is constructed only after ordinary contribution resolution retains the dynamic
  footprint and `getVisibleContributions` returns at least one drawable part. Hidden, `noDraw`, and
  fully transparent entities therefore reuse existing draw visibility rather than growing a
  second shadow-visibility state.
- `RenderWorld` gained only two feature-conditional seams: producer identity plus plural spatial
  membership for a visible dynamic, and exact scope plus installed world bounds for a visible
  EnvCell shell. The mutable scene graph and dynamic system remain private. Missing facts fail
  loudly because they contradict an already-visible contribution.
- Stable visibility islands are indexed once from the immutable topology view per enabled view.
  Candidate membership may name several cell scopes but deduplicates their island identities;
  cell selection compares island identity rather than flat render domain or resident cell alone.
- CPU transforms presentation bounds into canonical scene space before constructing bottom-center,
  horizontal radius, and conservative short-drop influence bounds. Cell intersection and camera
  distance stay in that common frame. Only retained `vec4` records convert to the current
  anchor-relative frame, immediately before shader consumption.
- Zero horizontal presentation radius produces no grounding caster because it cannot cover a
  fragment. Nonzero radius remains unscaled in the record; radius scale and drop spread only size
  the conservative CPU influence, leaving the matching appearance calculation to the shader.
- Intersecting candidates through the configured capacity preserve query order exactly. Overflow
  uses an insertion-ranked fixed-capacity nearest list, comparing squared camera distance and then
  producer-stable identity. No ranking or sort executes on the common path.
- Renderer-owned candidate/cell arrays, island index, selection map, fixed-record pool, and
  selection scratch are reused. This is safe because the established schedule prepares and draws
  one view before preparing the next; one selected record object is shared by every material draw
  belonging to the shell scope.
- Disabled views clear prior output but perform no topology indexing, dynamic grounding-fact read,
  proxy construction, EnvCell grounding-fact read, intersection, or overflow selection.
- Phase acceptance evidence: all 224 TypeScript test files (1,670 tests), complete app checks,
  TypeScript lint, dead-export checks, formatting, and focused world-boundary, category,
  coordinate-frame, island, intersection, pass-through, overflow, and tie-break tests passed.

### Phase 6: EnvCell-Shell Grounding Shader

#### Deliverables

- Add a documented shell-only object grounding mode without adding grounding declarations to
  ordinary object variants.
- Carry anchor-relative position and one up-facing scalar from the shell vertex shader.
- Add the fixed-capacity fragment uniform array, count, and indoor appearance uniforms.
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

- [x] Add the shell-only program option and varyings.
- [x] Add fixed grounding uniforms and state application.
- [x] Implement the bounded analytic fragment helper.
- [x] Associate one per-cell record set with every shell material draw.
- [x] Add shader-source, state-cache, flat, portal, and browser fixtures.

#### Decisions and Course Corrections

- Grounding is a compile-time `env-cell-shell` object-program role. Ordinary, instanced, resident,
  and outdoor object programs carry neither its varyings nor its fragment loop.
- Three shell variants are owned lazily: fogged baked, blended baked flat, and blended baked portal.
  The renderer fails loudly if a grounding program is selected without an active cell record set,
  or if a record set reaches an ordinary program.
- The helper evaluates all eight fixed slots with a dynamic retained count, uses strongest overlap,
  and applies the result after detail texturing but before fog. Empty cells bind only count zero.
- Fixed-size record arrays and the existing object-state cache make repeated material draws in one
  cell suppress identical uniform writes. The cache was extended with exact `vec4` array equality
  rather than adding grounding-specific mutable state.
- Generic frame instance-upload count and byte diagnostics now include each nonempty outdoor
  cascade upload. This reconciles the shared arena's existing capacity/high-water diagnostics
  instead of introducing a second, overlapping upload vocabulary.
- Baseline-WebGL2 fixtures link the outdoor and all three indoor shader families. Real flat and
  portal EnvCell harness runs preserved shell drawing, transparency routing, portal composition,
  and clean browser/GL consoles. The harness can stage a classified Drudge, but its current spawn
  placement resolves outdoors rather than into the selected EnvCell; populated-record appearance
  remains covered deterministically and is reserved for the Phase 10 interactive visual pass.
- Phase acceptance evidence: all 224 TypeScript test files (1,670 tests), complete app checks,
  TypeScript and dead-export lint, formatting, focused shader/state/selection tests, and flat,
  portal, and baseline-WebGL2 browser fixtures passed.

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

- [x] Add composite Explorer state and controls.
- [x] Add harness overrides and effective-setting output.
- [x] Integrate the mixed outdoor/indoor frame schedule.
- [x] Add toggle/reconfigure and mixed-portal coverage.

#### Decisions and Course Corrections

- Explorer owns one `EntityShadowSettings` value inside `FrameSettings` and replaces it through one
  validated composite callback. `ExplorerTools` and `ExplorerWorldPanel` pass that value intact;
  a focused control component handles the presentation-only field editing without multiplying
  top-level state or runtime methods.
- All outdoor and indoor fields are surfaced. Discrete compile/resource dimensions use selects;
  bounded appearance values use numeric controls whose limits match the authoritative validator.
  Interdependent up-facing limits are constrained relative to each other before the composite
  update reaches the runtime.
- The browser harness accepts one complete `--entity-shadows` JSON contract rather than twenty
  loosely related flags. Full harness output and brief evidence both emit the complete effective
  `frameSettings.entityShadows` value, so a capture can be copied, edited, and replayed exactly.
- A harness-only `--entity-shadow-cycle` exercises disable, re-enable, resize, and restore without
  reloading content. Cold target diagnostics are part of the ordinary renderer snapshot and have
  a named Explorer Frame-panel consumer; they are not timing-profile instrumentation.
- The cycle proved synchronous disposal of the active 1024x3 generation, one fresh allocation on
  re-enable, exact replacement by 256x3, and replacement back to 1024x3. Every step retained the
  same runtime and reported no browser-console or GL errors.
- The existing portal schedule needed no parallel shadow compositor. After portal planning, it
  builds outdoor maps once only when the selected plan contains the outdoor scope, derives indoor
  records from the same selected contributions, shades both receiver families into their ordinary
  scope-atlas tiles, and composites those completed pixels. Flat rendering builds the same maps
  before its ordinary scene query. The transition tunnel remains an explicit nonreceiver, while
  outgoing snapshots continue to capture the already-shaded scene target.
- The hybrid `0x7d640113` fixture selected one outdoor scope and five EnvCell scopes, submitted
  terrain plus 17 shell draws and 47 dynamic-part draws, and completed portal composition, SAO,
  particles, and all three nonempty cascade uploads without receiver crossover or stale state.
- Phase acceptance evidence: all 225 TypeScript test files (1,675 tests), complete app checks,
  TypeScript and dead-export lint, formatting, the same-runtime target cycle, and the real hybrid
  portal browser run passed.

### Phase 8: Stable Contact with an Animated Horizontal Footprint

#### Deliverables

- Separate the dynamic system's exact current rigid-pose bounds from its existing
  particle-expanded presentation footprint. Keep both facts producer-owned; do not reconstruct
  rigid bounds in the renderer or weaken particle-aware culling.
- Extend the feature-conditional `RenderWorld` indoor-grounding facts with the exact current rigid
  bounds. The already-resolved root placement remains the sole vertical-anchor authority.
- Replace `IndoorGroundingCaster.bottomCenter` vocabulary with a contact-anchor name that honestly
  describes the composite record:
  - X/Z center and radius come from current rigid-pose bounds transformed through root placement;
  - Y comes from the transformed entity-root origin;
  - particle envelopes contribute to neither.
- Preserve the existing GPU `vec4` layout, per-cell selection, shader loop, drop fade, and Explorer
  controls. This correction requires no new uniform, shader variant, draw pass, or setting.
- Update focused producer, world-boundary, selection, and shader tests plus the lighting
  documentation and this plan's accepted-design language.
- Reproduce WCID 8675 beside WCID 193 on the real GPU, inspect the selected records, and confirm the
  corrected appearance over the original shell-receiver courtyard.

#### Acceptance Criteria

- Two poses with different rigid X/Z bounds produce different horizontal centers and/or radii.
- Those same poses produce exactly the same caster Y when authoritative root placement is unchanged,
  even when their animated mesh minima differ or cross the receiving floor.
- Raising, falling, teleporting, or otherwise moving the authoritative root changes caster Y by the
  same world-space amount and retains the existing vertical spread/fade behavior.
- Growing or shrinking a particle envelope changes ordinary presentation/culling bounds but cannot
  change indoor grounding center, radius, or contact Y.
- WCID 8675 and WCID 193 both produce selected GPU records with root-anchored Y and pose-derived
  horizontal radii, and the corrected courtyard appearance is accepted by the user.
- Candidate limits, visibility-island filtering, overflow-only ranking, receiver classes, and
  disabled-mode work remain unchanged.
- No smoothing, pose union, anatomy heuristic, per-WCID override, or speculative radius clamp is
  introduced. Any objectionable horizontal excursion must first be demonstrated in visual review.

#### Task Checklist

- [x] Publish exact current rigid-pose bounds independently from particle-expanded bounds.
- [x] Carry rigid grounding bounds through the narrow feature-conditional renderer facts.
- [x] Construct animated X/Z plus root-anchored Y and sweep obsolete bottom-center vocabulary.
- [x] Add pose-invariance, root-movement, and particle-envelope isolation tests.
- [x] Reproduce and inspect the WCID 8675/WCID 193 records on the real GPU.
- [x] Update permanent lighting documentation and record execution evidence here.

#### Decisions and Course Corrections

- User visual review disproved radius tuning as the cause of WCID 8675's missing idle decal: WCID
  193 showed an exaggerated radius-three patch on the same receiver while WCID 8675 showed none.
  The shell shader rejects negative vertical drop before evaluating radius, so a current-pose mesh
  minimum below the receiver makes any radius setting irrelevant.
- A fully static proxy was rejected because the changing horizontal size was visually useful. The
  correction therefore separates axes rather than freezing the whole record: current rigid pose
  owns horizontal response, authoritative root placement owns vertical contact.
- Default-pose mesh minimum is not promoted to contact authority. It remains an authored geometry
  extremum and can be below or above the physical contact plane for the same reasons as a current
  pose. The root is already the placement/solver authority and existing contact bias covers its
  small solver tolerance.
- Particle envelopes are explicitly excluded. They exist to keep emitted effects alive in culling;
  letting them resize an entity-grounding cue couples two unrelated presentation policies.
- Horizontal smoothing and clamping are deferred by design. They add state and tuning policy before
  representative motion has shown a problem, while the requested pose-reactive behavior is already
  available from exact rigid bounds.
- The implementation publishes exact current rigid bounds beside the existing particle-expanded
  presentation bounds. It reuses the existing indoor-grounding `vec4` and shader path, so the fix
  adds no GPU field, uniform, pass, setting, or renderer-owned reconstruction.
- Focused coverage proves pose-varying horizontal footprints, root-invariant contact Y, exact root
  motion, and particle-envelope isolation. The complete TypeScript suite passes with 1,677 tests in
  225 files; type checking, lint, dead-code analysis, and formatting also pass.
- A real-GPU run through ANGLE/Vulkan on an RX 7900 XT selected both comparison casters. WCID 8675
  produced root Y `12.5` and rigid radius `0.66116455280644`; WCID 193 produced the same root Y and
  rigid radius `0.35770076788499663`. The selected WCID 8675 GPU record preserved those values.
- The available harness position put the entities over an EnvCell resident tile floor, not an
  EnvCell shell receiver. The absence of a visible patch there is therefore correct under the
  accepted receiver policy and cannot serve as the final visual comparison. Temporary diagnostics
  were removed instead of broadening indoor receivers to make the harness fixture pass.
- The user's subsequent Explorer review over the original shell-receiver courtyard confirmed that
  the corrected animated-footprint shadows look good. Phase 8 visual acceptance is complete.

### Phase 9: Three-Level Shadow Quality Modes

#### Deliverables

- Replace the boolean `EntityShadowSettings.enabled` authority with the exhaustive mode
  `"none" | "simple" | "shadow-maps"`; do not retain a compatibility boolean or derive mode in
  multiple consumers.
- Rename indoor-specific analytic policy, selection, shader, uniform, and diagnostic vocabulary to
  entity grounding where it is genuinely shared. Keep EnvCell-shell program ownership narrow and
  leave historical PSSM-only symbols precise.
- Preserve one grounding settings value across both enabled modes. Mode changes retain inactive
  tuning values so Explorer switching is reversible without inventing per-mode copies.
- Add outdoor analytic candidate selection per visible terrain landblock:
  - reuse ordinary-view visible roots and admit only classified spawned entities with outdoor
    spatial membership;
  - intersect each caster's horizontal influence bounds with the landblock's canonical footprint;
  - preserve encounter order through the configured per-receiver capacity;
  - only on overflow, retain the configured nearest candidates by squared camera distance and
    stable identity;
  - admit a border-crossing influence into both adjacent landblocks.
- Add one lazy analytic-grounding near-terrain shader variant using the shared fragment evaluator
  and fixed `vec4` records. Bind each landblock's record set immediately before its existing terrain
  draw; add no decal geometry, per-caster draw, texture, framebuffer, or rendering pass.
- Keep analytic outdoor reception terrain-only. Buildings continue to receive PSSM exclusively in
  `shadow-maps`; explicit/Generated outdoor objects and far terrain receive neither simple shadow.
- Keep a terrain landblock with nonempty analytic records on the near-terrain path, just as active
  PSSM coverage already retains its required receiver path. Do not add grounding to the simplified
  far-terrain shader.
- Schedule work directly from mode:
  - `none` skips both candidate families, selects ordinary receivers, and releases PSSM targets;
  - `simple` prepares indoor and outdoor analytic records and keeps PSSM disabled/released;
  - `shadow-maps` prepares indoor analytic records and outdoor PSSM, but no outdoor analytic set.
- Replace the Explorer checkbox with a three-option quality selector. Show analytic controls for
  both enabled modes and PSSM controls only for `shadow-maps`, while retaining their values when
  hidden.
- Update lighting, portal-rendering, Explorer, and plan documentation with the exact mode matrix.

#### Acceptance Criteria

- `none` reproduces the existing disabled picture and performs no analytic or PSSM preparation,
  receiver binding, depth submission, or retained target ownership.
- `simple` renders analytic grounding only on outdoor near terrain and EnvCell shells. Outdoor
  Buildings and every other object program contain no grounding declarations or uniforms.
- `shadow-maps` preserves the accepted current result: outdoor terrain/Buildings PSSM and EnvCell
  analytic grounding, with no outdoor analytic candidate work.
- Outdoor landblocks upload at most eight records, sort only on overflow, and share a border caster
  wherever its influence intersects both receiver bounds.
- Simple outdoor grounding uses the same root-stable, pose-reactive caster facts and the same
  strongest-overlap fragment math as indoor grounding.
- Terrain remains one draw per landblock; simple mode adds neither caster geometry nor a separate
  pass. A nonempty record set may only add a bounded uniform upload and select the near receiver
  program.
- Flat and portal-composited outdoor terrain consume identical anchor-relative record sets, and
  switching modes cannot expose stale PSSM or analytic state.
- The default is `shadow-maps`, and every mode plus every applicable tuning control is live in the
  Explorer.

#### Task Checklist

- [x] Cut settings and Explorer state over from `enabled` to the exhaustive mode.
- [x] Generalize genuinely shared analytic-grounding names and contracts.
- [x] Add pure per-landblock candidate construction and overflow-only selection tests.
- [x] Add and integrate the lazy near-terrain grounding program.
- [x] Gate preparation, receiver selection, and PSSM target lifetime by mode.
- [x] Cover flat/portal routing, border influence, far-terrain retention, and rapid mode changes.
- [x] Update permanent documentation and record execution evidence here.

#### Decisions and Course Corrections

- The three levels are presentation quality modes, not independent feature toggles. One enum makes
  impossible combinations unrepresentable and gives every scheduler a single authority.
- The existing analytic effect is a procedural radial distance-field calculation, not an SDF
  texture. Reuse means sharing its bounded records and fragment math; no texture atlas or decal
  geometry is introduced.
- Outdoor simple reception is deliberately terrain-only. Extending it to Buildings would require
  baked/instanced and opaque/blended object variants while encouraging blobs on walls and roofs;
  neither complexity nor appearance serves the grounding goal.
- Outdoor selection is per terrain landblock rather than global. This preserves the configured
  per-receiver bound without letting a crowd elsewhere suppress nearby grounding, while influence
  intersection admits border casters to both sides.
- Analytic attenuation remains a post-lighting grounding cue in both domains. Making the outdoor
  version attenuate sunlight alone would make simple-mode grounding depend on sun direction and
  intensity, undermining its isomorphic purpose.
- Simple mode uses one grounding-capable program for the near-terrain batch and binds a zero-count
  record set for empty landblocks. Only a nonempty record set promotes a landblock from simplified
  far terrain. This preserves one draw per landblock and stable batching without compiling analytic
  code into the far-terrain or object families.
- The shared per-receiver caster capacity is authored once in `frontend-tuning.ts` and defaults to
  eight. That build-time value sizes selection storage and generated GLSL together; a conservative
  baseline-WebGL2 ceiling fails invalid tuning before shader compilation.
- Phase acceptance evidence: complete app type/Svelte checks, all 225 TypeScript test files (1,683
  tests), terrain-shader validation, TypeScript and Rust lint, dead-export checks, formatting, and
  focused settings, selection, border-overlap, shader-source, uniform-binding, PSSM-pass, and
  terrain-program tests passed. The real-GPU browser harness exercised `none`, `simple`,
  `shadow-maps`, target resize, and restoration without reloading, both with an empty dynamic set
  and with NPC/vendor WCID 702 rendering 71 visible parts. Final visual comparison and tuning remain
  Phase 10 work.

### Phase 10: Final Visual Review, Cleanup, and Verification

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
  - `none`, `simple`, and `shadow-maps` mode equivalence and transitions.
- Tune outdoor PSSM and analytic grounding defaults from captures.
- Present all three modes for the user's final acceptance; profiling is not an acceptance gate.
- Sweep obsolete universal-shadow, interior-light, receiver-attachment, and indoor-shadow-map
  terminology from code, fixtures, UI, and documentation.
- Update `docs/lighting.md` with outdoor directional shadows and stylized indoor grounding.
- Update `docs/portal_rendering.md` with the receiver-owned technique boundary, outdoor world-space
  lookup, and visibility-island indoor candidate policy.
- Update this plan's status, checklists, decisions, and deferred debt.

#### Acceptance Criteria

- The user has accepted the tuned appearance and receiver behavior of all three modes.
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
- Renderer destruction and mode-change/reconfigure cycles leak no outdoor shadow resources.
- Documentation describes the implementation that landed rather than the discarded universal-PSSM
  proposal.

#### Task Checklist

- [x] Perform the architecture and sLOC resteer.
- [x] Run the complete visual matrix and tune defaults.
- [x] Record the user's final three-mode acceptance and remaining debt.
- [x] Collapse accidental abstractions and sweep stale vocabulary.
- [x] Update lighting and portal documentation.
- [x] Run Rust, TypeScript, Svelte, lint, format, and browser verification.
- [x] Complete this plan's execution record.

#### Decisions and Course Corrections

- The architecture review counted 2,635 lines across the twelve new production modules that own
  policy/validation, cascade math, caster selection, the depth pass and target lifecycle, receiver
  bindings/program catalogs, indoor selection/shader support, and Explorer controls. No module is
  a trivial one-call abstraction: the splits keep pure math and selection testable, isolate GPU
  lifetime/state ownership, and prevent indoor declarations from entering ordinary object
  programs. The three outdoor receiver and three indoor shell variants are the minimum existing
  baked/instanced/fog/portal combinations rather than a new generic shader framework.
- The review found one real scheduling mistake: portal views built outdoor maps before portal
  planning, so a sealed indoor view could execute three unnecessary depth submissions. Portal
  rendering now clears prior frame state, plans scopes first, and invokes PSSM only when that plan
  contains the outdoor scope. A sealed `0x7d64010e` portal run retained one ordinary instance
  upload and performed no cascade upload; flat behavior is unchanged.
- The terminology sweep found no surviving implementation vocabulary for the discarded universal
  shadow, indoor shadow-map, receiver-attachment, or shell-lighting-role proposals. The remaining
  occurrences in this plan describe explicit exclusions. `docs/lighting.md` now documents the two
  receiver-owned techniques, while `docs/portal_rendering.md` documents the outdoor planning gate,
  world-space lookup, visibility-island records, and transition ownership.
- The first outdoor comparison was invalid: Explorer focus plus a pose-only four-unit camera-ray
  spawn left the Drudge roughly 46 world units above terrain and pointed its short shadow toward
  the overview camera. The authoritative simulated-body path settled that same spawn at AC
  elevation `20.003325` with grounded contact. A derived camera two units above that surface and
  ten units away produced a deterministic default-on/off pair with a compact coherent terrain
  shadow at the Drudge's contact point.
- A populated indoor `0x7d64010e` pair likewise isolated one soft bounded patch beneath the
  Drudge, with no changes elsewhere in the cell. Both defaults are intentionally subtle grounding
  cues. The user subsequently accepted the corrected indoor appearance; the broader
  category/cascade/crowd/island/transition and new three-mode visual matrix remains in Phase 10
  rather than being represented as complete by shader and policy tests.
- User visual review exposed an Explorer-only presentation regression that the HTTP browser harness
  could not reproduce: the cold entity-panel snapshot used deep Svelte `$state`, and the snapshot
  event later passed that proxy back into presentation. Setup visual loading then forwarded the
  proxied appearance through Electron IPC, whose structured-clone boundary correctly rejected it.
  The panel snapshot is replace-only, so it now uses `$state.raw`; renderer/runtime inputs remain
  ordinary host DTOs without adding defensive cloning to shared presentation code. An actual
  Electron Explorer run loaded `0xda55ffff` and concurrently realized WCID 3 (Olthoi Worker) plus
  WCID 8675 (Asheron), reporting two current entities and no renderer or structured-clone error.
- The user completed the final manual matrix and accepted all caster categories, receiver domains,
  indoor/outdoor edge cases, portal behavior, and all three modes at the landed defaults. No visual
  tuning change or remaining blocking debt was requested.
- The pre-commit quality pass found one real contract mismatch after the caster capacity moved into
  frontend tuning: validation admitted up to 32 records, but the object uniform cache still capped
  all locations at the old eight-record/32-component width. Uniform history now allocates the exact
  stable width per location, while scalar/vector scratch remains four components. Capacity-sensitive
  tests import the runtime constant, and shared dynamic-fact/uniform-attempt vocabulary no longer
  claims the analytic path is indoor-only.
- Final acceptance verification passed all 225 TypeScript test files (1,683 tests), complete Svelte
  and TypeScript checks, TypeScript/Rust/dead-export lint, formatting, 246 host tests, 295 core tests,
  and combined core/host clippy with warnings denied. The real-GPU mode cycle reported no page or
  GL error: `none` and `simple` retained zero PSSM textures, while `shadow-maps` allocated one
  three-layer array, resized from 1024 to 256, and restored it to 1024.

## Risks and Mitigations

| Risk                                                          | Consequence                                                  | Mitigation                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Client and Explorer category fact adapters drift              | Equivalent actors participate differently                    | Share one semantic category policy with narrow live/template adapters, carry one resolved enum, and cover representative fixtures |
| Outdoor caster alpha is ignored                               | Hair or clothing can cast solid silhouettes                  | Accept the first-version tradeoff and keep the depth pass material-free                                                           |
| Off-camera outdoor casters are omitted                        | Shadows pop at screen edges                                  | Query cascade light frusta rather than reuse camera-visible dynamic submissions                                                   |
| Outdoor-shadow-only dynamic animation is not retained         | An off-camera cast silhouette freezes                        | Union outdoor caster roots into the existing renderer animation-liveness feedback; indoor candidates already use visible roots    |
| Reused scene-query entries are overwritten                    | A later cascade query corrupts an earlier caster set         | Fully consume each query before issuing another; retain only owned compact caster records                                         |
| Depth submission bypasses frame-instance batching             | Crowds multiply caster draw calls and transform uploads      | Use an attribute-instanced depth program and the existing compatible-run/arena vocabulary                                         |
| Indoor selection queries once per cell                        | Cell-grid rooms repeat broadphase work                       | Collect eligible dynamic roots once from the ordinary view query and intersect the compact pool against visible shells            |
| PSSM state corrupts later portal/object draws                 | Subsequent passes render incorrectly                         | Restore explicit framebuffer/viewport state and invalidate cached object routing after shadow submission                          |
| Cascade matrices swim                                         | Distracting outdoor shimmer                                  | Use stable fits, texel snapping, deterministic camera sweeps, and final screenshot review                                         |
| Bias tuning detaches outdoor shadows                          | Peter-panning                                                | Keep constant, normal, and polygon-offset controls separate and bounded                                                           |
| Far-terrain optimization overlaps shadow coverage             | Visible terrain shadow gap                                   | Keep terrain inside maximum distance on the shadow-capable near path                                                              |
| Grounding code bloats every object shader                     | Nonreceiver cost and variant sprawl                          | Compile one shell-only grounding option; ordinary programs contain no grounding declarations                                      |
| A decal lies inside one large floor triangle                  | Vertex-only evaluation misses it                             | Evaluate the radial function per fragment and interpolate only position/up-facing weight                                          |
| A receiver exceeds its configured caster capacity             | A farther visible decal is omitted                           | Invoke deterministic nearest-camera partial selection only on overflow; treat omission as the declared quality budget             |
| Common receivers pay unnecessary sorting cost                 | Frame-hot CPU overhead grows for no visual benefit           | Preserve candidate order and skip all ordering work through the configured per-receiver capacity                                  |
| Cell-grid room seams split a blob                             | Grounding pops at invisible EnvCell boundaries               | Select by influence-volume/cell intersection across same-island cells rather than resident scope alone                            |
| Overlapping cells contaminate grounding                       | A caster grounds an unrelated stacked shell                  | Require stable visibility-island equality and bound vertical drop/radius                                                          |
| Same-island structures do not occlude blobs                   | A short decal can reach a nearby unintended floor            | Keep the effect short, suppress non-upward surfaces, and accept that it is grounding rather than light transport                  |
| Crowds blacken the floor                                      | Overlapping decals look like soot                            | Combine by strongest contribution rather than addition or multiplication                                                          |
| Animated mesh minima cross receiving floors                   | A selected caster disappears before radius evaluation        | Anchor caster Y to authoritative root placement while retaining pose-reactive rigid X/Z bounds                                    |
| Particle envelopes contaminate grounding                      | Temporary effects resize or move an actor's decal            | Publish exact rigid-pose bounds separately and keep particle expansion only in presentation/culling bounds                        |
| Animated horizontal bounds produce an objectionable excursion | A blob changes size or center too abruptly                   | Prove the case in representative motion first; add the narrowest clamp or smoothing only if visual review requires it             |
| Repeated shell material draws rewrite identical uniforms      | CPU submission work grows                                    | Compute one cell record set and let the object-state cache suppress identical consecutive writes                                  |
| Mode changes leave stale work or resources active             | A lower mode retains hidden cost or stale shading            | Gate each path from the exhaustive mode, clear analytic sets, and release PSSM targets outside `shadow-maps`                      |
| Adjacent outdoor landblocks choose different overflow sets    | A dense border crowd can expose a simple-shadow seam         | Intersect each influence with both bounds and use identical camera/identity ranking; verify overflow borders visually             |
| Simple grounding promotes distant terrain to the near shader  | A remote visible caster defeats the far-terrain optimization | Retain near terrain only for landblocks with nonempty records; keep the configured record cap and omit analytic code from far terrain  |
| Portal transition invents a second shadow lifecycle           | Snapshot/tunnel resources become tangled with world shading  | Keep effects inside ordinary scene rendering; outgoing color is already shaded and the tunnel is excluded                         |

## Definition of Done

- [x] Every dynamic frontend view carries one explicit `player`, `npc`, `mob`, or `other` category.
- [x] Category is serialized as presentation policy, resolved before the source-neutral projector,
      and never reconstructed from radar color.
- [x] Only spawned players/NPCs/mobs participate in either effect.
- [x] Outdoor actor geometry casts material-agnostic PSSM shadows only onto terrain in range and
      Buildings-layer geometry.
- [x] Outdoor PSSM attenuates regional-sun diffuse without altering ambient, point, baked, detail,
      fog, luminosity, or color-grade terms.
- [x] `simple` applies analytic grounding only to outdoor near terrain and EnvCell shells;
      Buildings and every other object remain ordinary outdoors.
- [x] `shadow-maps` applies PSSM to outdoor terrain and Buildings and analytic grounding to EnvCell
      shells, without outdoor analytic candidate work.
- [x] EnvCell shells evaluate at most the configured analytic-grounding caster capacity; residents
      and other object programs contain no grounding work.
- [x] Indoor caster Y follows authoritative root placement and is invariant under animation, while
      current rigid-pose X/Z bounds retain animation-reactive center and radius.
- [x] Particle envelopes and temporary effects cannot change indoor grounding records.
- [x] Indoor candidate counts through the configured capacity preserve order; overflow
      deterministically keeps the nearest candidates by squared camera distance and GUID tie-break.
- [x] Outdoor terrain landblocks obey the same configured-capacity and overflow-only ranking policy,
      and intersecting border casters contribute to both adjacent receivers.
- [x] Same-island adjacent cells share intersecting decals while different-island overlapping cells
      do not.
- [x] Outdoor-shadow-only dynamic roots keep their existing animation presentation live; indoor
      grounding adds no separate animation-liveness path.
- [x] Flat and portal rendering honor the same indoor selection facts, outdoor analytic records,
      and outdoor world-space maps for the selected mode.
- [x] Portal-transition snapshots contain the capture frame's completed shading, incoming shading
      remains live, and transition tunnel geometry participates in neither effect.
- [x] The exhaustive `none`/`simple`/`shadow-maps` selector and all applicable appearance parameters
      are live in Explorer, with `shadow-maps` as the default.
- [x] `none` allocates no outdoor targets, performs no caster/candidate work, selects no analytic
      receiver, and reproduces the pre-feature picture.
- [x] Category, settings, cascade math, target lifecycle, caster/receiver, indoor selection, shader,
      outdoor analytic selection, scope, mode-transition, and browser tests pass.
- [x] Final visual review accepts the defaults and records the user's three-mode acceptance.
- [x] Lighting, portal documentation, and this plan describe the hybrid implementation and accepted
      limitations.

## Open Questions

None. The user accepted the landed PSSM and analytic-grounding defaults across the complete
three-mode visual matrix.
