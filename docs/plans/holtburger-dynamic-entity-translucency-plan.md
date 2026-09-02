# Holtburger Dynamic Entity Translucency Plan

Status: **Implemented and verified 2026-09-02.**

## Context and Boundaries

### Goal

Render ACE object-level translucency faithfully for setup-backed dynamic entities in both Explorer
and Client modes, using the existing per-part effect state and transparent renderer path without
making translucency part of material, geometry, or visual-template identity.

### In Scope

- Preserve optional `PropertyFloat::Translucency` (76) in the offline Explorer weenie catalog.
- Project one validated current object-translucency level from both dynamic-entity producers:
  - Explorer reads the catalog template;
  - Client reads the hydrated live entity property.
- Carry that level through the source-neutral dynamic-entity view and strict frontend feed schema.
- Initialize every setup part's effect translucency before default animation, motion, or physics
  script replay can dispatch part-local effects.
- Apply same-generation translucency changes through retained presentation state without rebuilding
  setup visuals, geometry, material bindings, textures, behavior closures, or scene nodes.
- Preserve the existing interaction between object translucency, `TransparentPart` hooks, cloaking,
  `NoDraw`/`Hidden`, authored surface opacity, transparent ordering, and full suppression.
- Bump the `.hwc` catalog format and regenerate local/package catalog artifacts as a clean cutover.
- Add focused Rust, TypeScript, and browser-harness evidence for WCID 1758 (`Shadow`) and synthetic
  edge cases.

### Out of Scope

- Changing `CSurface.translucency`, surface flags, texture alpha decoding, blend-factor selection,
  transparent sorting, or WebGL shader equations. Those paths already consume per-instance alpha.
- Adding WCID-, setup-, creature-, or Shadow-specific policy.
- Implementing the currently raw whole-object animation hook type 20 (`Transparent`). This plan
  addresses object state supplied by `PhysicsDesc`/`PropertyFloat::Translucency` and retains the
  existing typed `TransparentPart` hook behavior. Whole-object hook support needs its own proven
  data census and command semantics.
- Reworking static object materialization. The affected ACE property belongs to live/setup-backed
  physics objects and must not turn static layer batching into per-object mutable state.
- Backward-compatible decoding of `.hwc` v9. Repository policy favors a clean format cutover and
  explicit regeneration.
- Opportunistic changes to unrelated dynamic presentation, renderer, portal, or entity-shadow
  behavior.

## Ground Truth and Existing Seams

### Confirmed Failure Path

- ACE World currently stores `weenie_properties_float(type = 76, value = 0.5)` for WCID 1758.
- WCID 1758 uses setup `0x02000001`, a 34-part human setup. Its opacity is therefore an object
  physics-description fact applied across parts, not a transparent material authored by that setup.
- `crates/holtburger-protocol/src/messages/object/messages/description.rs` decodes optional
  `ObjectDescriptionData.translucency` from `PhysicsDescriptionFlag::Translucency`.
- `crates/holtburger-world/src/hydration.rs` correctly stores the decoded value as
  `PropertyFloat::Translucency`.
- `crates/holtburger-core/src/client/dynamic_entity_view.rs` does not read that stored property into
  `DynamicEntityView`, so Client mode loses it at the shared projection boundary.
- `crates/holtburger-weenie-catalog/src/model.rs` has no corresponding template field, and
  `apps/holtburger-tools/src/weenie_catalog_export.rs` does not select property type 76, so Explorer
  mode loses it during offline extraction.
- `apps/holtburger-3d/src/lib/game/systems/effect-system.ts` initializes every part translucency to
  zero. Because neither producer supplies another value, both modes deterministically render the
  entity opaque.

### Retail Semantics

- `CPhysicsObj` copies `PhysicsDesc.translucency` into `translucencyOriginal` and the current object
  translucency, then calls `CPartArray::SetTranslucencyInternal` when the value is nonzero
  (`acclient.c:310488-310498`).
- `CPartArray::SetTranslucencyInternal` visits every setup part and calls
  `CPhysicsPart::SetTranslucency` (`acclient.c:313392-313404`).
- `CPhysicsPart::SetTranslucency` suppresses a part only at exactly `1.0`; otherwise it stores the
  current translucency and updates its material copy (`acclient.c:303936-303962`).
- Runtime whole-object translucency writes are clamped so they cannot make the object less
  translucent than `translucencyOriginal` (`CPhysicsObj::SetTranslucencyInternal`,
  `acclient.c:305250-305259`). Part-local `TransparentPart` writes address the part directly and do
  not perform that object-level clamp.
- `CPhysicsPart::SetTranslucency` ignores writes while the owning physics object carries the Cloaked
  state bit. The existing frontend intentionally preserves its last part render state while cloaked;
  this plan must not invent a second cloak-alpha policy.

### Current Content Distribution

A 2026-09-02 query against the project ACE World database found:

- 928 templates author `PropertyFloat::Translucency`;
- all 928 have a setup DID;
- 911 author partial translucency and 17 author exactly `1.0`;
- values range from `0.1` through `1.0`;
- 546 affected templates are `WeenieType::Creature`;
- `0.5` is the most common value, used by 569 templates.

The implementation should therefore support the complete unit interval. This is not a rare Shadow
exception, and exact `1.0` suppression is observable content behavior.

### Existing Implementation Seams

- `crates/holtburger-weenie-catalog` owns the portable Explorer source record. Adding a stored field
  requires codec changes and a format-version bump.
- `apps/holtburger-tools/src/weenie_catalog_export.rs` is the sole ACE World extraction boundary.
  It already maps a deliberately selected set of float properties into `WeenieTemplate`.
- `DynamicEntityDefinition` retains producer facts across Explorer registry/body projection, while
  `DynamicEntityViewSource` and `DynamicEntityView` provide the shared wire-facing projection.
- Client `WorldEvent::PropertiesUpdated` already emits a same-generation dynamic-entity upsert, so
  no new transport event or subscription is needed for a live translucency property change.
- `game-presentation-runtime.ts` already partitions entity changes into immutable visual identity,
  placement identity, and mutable presentation-state identity. Translucency belongs in the last
  category.
- `DynamicEntitySystem.updatePresentationState` already applies presentation-only levels without
  reacquiring resources or rebuilding the entity tree.
- `EffectSystem` owns persistent whole-object and per-part visual-effect state. It is the only owner
  that can initialize object translucency before behavior replay and then compose it with later
  `TransparentPart` commands.
- `DynamicEntitySystem` already maps part translucency `t` to instance alpha `1 - t`, promotes an
  otherwise opaque draw to transparent ordering, and suppresses exactly `t == 1`.
- The object shader multiplies source material color/opacity by per-instance color, so object and
  surface opacity already compose without a new uniform or shader variant.

## Settled Direction Decisions

1. **Object translucency is a mutable presentation level, not a material fact.** It must not enter
   `ResolvedMaterial`, material binding IDs, compiled draw keys, or texture requirements.
2. **It is not immutable visual identity.** A same-generation client property update must update
   retained effect state without changing `dynamicVisualKey`, template fingerprints, or resource
   leases.
3. **Producers normalize absence once.** Catalog storage remains `Option<f64>` to preserve ACE
   absence, while the shared runtime/view contract carries a required `f32` where absence has become
   retail's effective `0.0`.
4. **The accepted runtime domain is `0.0..=1.0`.** All observed object-property content lies in that
   interval. Non-finite or out-of-range values fail at the producer/shared validation boundary
   rather than being silently clamped. The legacy byte-scale handling in `sourceOpacity` is a
   `CSurface` concern and is not evidence for accepting malformed physics-description values.
5. **Initial state is installed before behavior replay.** Every part begins at the object level;
   later `TransparentPart` hooks may explicitly replace addressed part values. Applying the object
   value after replay would erase authored part state.
6. **One composite presentation update owns ordering.** `cloaked`, `hidden`, `lighting`, `noDraw`,
   and object translucency travel through the existing `DynamicEntityPresentationState` update.
   Consumers do not independently race a translucency mutation against a cloak mutation.
7. **The existing renderer is the consumer, not a change target.** Correct upstream state should
   naturally exercise its current alpha, ordering, sorting, portal, and suppression paths.
8. **Catalog v10 is a clean cutover.** Old catalogs fail loudly and are regenerated. No nullable
   tail parsing, dual codec, or compatibility shim survives the change.

## North Stars

1. The same authoritative fact should produce the same picture in Explorer and Client modes.
2. Mutable presentation must remain cheap: changing opacity should not touch immutable visual or GPU
   resource identity.
3. Object state and material state stay lossless and independent; the final shader composition is
   where their opacities meet.
4. Behavior replay must begin from a complete object state so late realization reconstructs the
   current picture without needing a missed event history.
5. Retail precedence is proved from code and tests, never inferred from how one Shadow happens to
   look.

## Phase 0: Lock Semantics and Test Fixtures

Status: **Complete.**

Establish the exact state-transition contract before widening production types.

### Deliverables

- Add focused effect-system tests that express the required precedence without changing production
  behavior yet:
  - installation with object translucency initializes every part;
  - a later `TransparentPart` command changes only the addressed part;
  - exact `1.0` remains a render suppression value;
  - object and part values remain unchanged while cloaked according to the existing retail-backed
    rule.
- Confirm from retail `set_state`/cloak transitions whether a whole-object translucency update
  received while already cloaked is merely ignored by parts or reapplied on uncloaking. Encode only
  the proven result in the composite update test.
- Identify the shared test builders for `WeenieTemplate`, `DynamicEntityDefinitionInput`,
  `DynamicEntityProjectionInput`, and `DynamicEntityView` so the new required field is introduced in
  one helper per test domain where practical rather than copied ad hoc through fixtures.

### Acceptance Criteria

- Every intended interaction has a named test case and retail citation.
- No unresolved cloak/update ordering decision remains before production state is changed.
- Fixture churn has an explicit set of shared constructors; there is no temptation to add a default
  parameter that hides missing production data.

### Task Checklist

- [x] Prove cloak/update transition semantics from retail
- [x] Add effect-state initialization and precedence tests
- [x] Inventory and consolidate affected fixture builders

### Decisions and Course Corrections

- Retail `CPhysicsObj::set_state` (`acclient.c:310307-310336`) handles lighting, no-draw, and hidden
  transitions but does not reapply object translucency when Cloaked clears. A whole-object write
  received while already cloaked is therefore ignored by the parts and remains ignored after
  uncloaking; the frontend composite update must preserve that exact transition.
- The effect-system tests require the production installation input that Phase 4 introduces. They
  are being added atomically with that API rather than as uncompilable failing tests. The named
  scenarios and citations are settled now; this is sequencing debt only, not a semantic gap.
- Existing fixtures are mostly direct Rust struct literals guarded by compiler exhaustiveness. The
  catalog fixture remains the shared codec source; dynamic-definition and view fixtures will be
  amended at their local builders instead of adding defaults that could hide omitted production
  facts.

## Phase 1: Explorer Catalog v10 Cutover

Status: **Complete.**

Preserve the raw optional ACE World fact in the Explorer's offline source record.

### Deliverables

- Add documented `translucency: Option<f64>` to `WeenieTemplate`.
- Add `PROPERTY_FLOAT_TRANSLUCENCY: u16 = 76` to the exporter and include it in the selected SQL
  property set, row projection, duplicate detection, and test fixtures.
- Encode and decode the optional float in the canonical record field order.
- Include the field in catalog finite-value validation.
- Bump `CATALOG_FORMAT_VERSION` from 9 to 10 and update its history comment.
- Update `docs/ace_world_weenie_catalog.md` to document v10 and the new record field.
- Regenerate the ignored local `dats/weenies.hwc` using the existing exporter and configured ACE
  World database. Update any packaged/fixture catalog artifact that is actually tracked or embedded;
  do not commit an ignored local artifact accidentally.

### Acceptance Criteria

- Catalog round trips distinguish `None`, `Some(0.0)`, `Some(0.5)`, and `Some(1.0)`.
- Non-finite source values are rejected with WCID and field context.
- Export projection maps only ACE float type 76 to `translucency` and continues rejecting unexpected
  selected property types.
- A newly exported catalog lookup for WCID 1758 returns `Some(0.5)`.
- A v9 catalog is rejected as unsupported; no compatibility reader exists.

### Task Checklist

- [x] Extend catalog model and fixtures
- [x] Extend exporter selection and projection
- [x] Extend codec and validation
- [x] Bump format and durable documentation
- [x] Regenerate and inspect the local catalog

### Decisions and Course Corrections

- The v10 field is inserted beside the other physics floats, before motion magnitudes. This is an
  intentional clean format cutover; the reader continues to reject v9 rather than guessing whether
  a nullable tail is present.
- Catalog and tool library suites pass after the model/codec/export change (22 and 31 tests,
  respectively). The real ACE World export and WCID 1758 inspection remain the phase gate.
- The exporter regenerated the ignored `dats/weenies.hwc` with 43,913 templates. The existing
  `weenie_motion_facts` diagnostic now reports catalog translucency and confirmed WCID 1758 decodes
  as `Some(0.5)` with setup `0x02000001`; no tracked packaged catalog artifact exists to update.

## Phase 2: Shared Dynamic-Entity Contract

Status: **Complete.**

Normalize and retain one source-neutral object-translucency level across both producer
compositions.

### Deliverables

- Add required `translucency: f32` to `DynamicEntityDefinitionInput`, validate it as finite and in
  `0.0..=1.0`, and retain it on `DynamicEntityDefinition`.
- Add a dedicated `InvalidTranslucency` definition error rather than folding the failure into scale
  or generic scalar validation.
- Carry translucency through `DynamicEntityProjectionInput` and `DynamicEntityViewSource`.
- Add documented `translucency` to `DynamicEntityPhysicsView`, alongside the other current
  presentation-relevant physics-description consequences. Remove `Eq` from only the containing type
  if the float requires it; do not weaken equality on unrelated types.
- Explorer converts `WeenieTemplate::translucency.unwrap_or(0.0)` through its existing checked
  `f64`-to-`f32` scalar boundary and supplies it to definition preparation.
- Client reads `PropertyFloat::Translucency`, normalizes absence to `0.0`, validates the result, and
  supplies it to the same view projection.
- Ensure Explorer registry/body snapshots and replacements retain the value exactly as they retain
  scale and appearance, so later projections do not re-read the catalog.

### Acceptance Criteria

- Equivalent Explorer and Client source fixtures project the same required `0.5` view value.
- Source absence projects exactly `0.0`; explicit zero remains accepted.
- NaN, infinity, negative values, and values above one are rejected with a translucency-specific
  error.
- A client `PropertiesUpdated` event for `PropertyFloat::Translucency` emits a same-generation
  dynamic upsert containing the new value.
- No setup, material, texture, body, or spatial type gains translucency merely to transport it.

### Task Checklist

- [x] Extend and validate dynamic definition state
- [x] Extend projection input/source/view state
- [x] Project Explorer catalog values
- [x] Project Client hydrated values
- [x] Add producer-parity and update-event tests

### Decisions and Course Corrections

- Absence is normalized exactly once in each producer: Explorer after checked `f64` narrowing and
  Client after hydrated property lookup. Definition and Client projection reject non-finite,
  negative, and above-one values with translucency-specific errors.
- The value is retained beside semantic definition/view state and deliberately does not enter
  physical preparation, setup content, appearance, or radar types. Adding the float required
  removing `Eq` only from `DynamicEntityPhysicsView`; unrelated equality contracts remain intact.
- Producer-parity now exercises `0.5`, and the Client properties-updated test proves a
  same-generation upsert carries the new level. Core (331 tests) and 3D host (260 tests) suites pass.

## Resteer: Contract and Precedence Audit

Status: **Complete.**

Before touching frontend realization, inspect the landed Rust shape and dry-run the remaining state
flow.

### Checklist

- [x] Confirm exactly one normalized required value exists after each producer boundary
- [x] Confirm the value is absent from physical preparation and visual resource identity
- [x] Confirm snapshots and same-generation upserts both reconstruct the same level
- [x] Re-run the initialization/replay ordering against the actual frontend activation sequence
- [x] Reassess whether any planned API would duplicate `EffectSystem` ownership

### Decisions and Course Corrections

- Frontend activation replays default behavior while a staged entity is being prepared, before the
  runtime reapplies its current presentation identity. Applying object translucency only in the
  later runtime update would therefore erase or reorder part-local replay. The resident source must
  carry a non-fingerprinted initial presentation state beside immutable visual source data.
- `EffectSystem` remains the sole per-part effect-state owner. The dynamic entity system will seed
  it at installation and route later whole-object state changes into it; renderer/material identity
  receives no parallel opacity mechanism.
- Retail initializes semantic state before applying the PhysicsDesc translucency. Consequently an
  initially cloaked entity seeds zero, and an authored whole-object level is not replayed merely
  because cloak later clears.

Any discovered ambiguity in retail cloak or hook precedence is a stop-and-prove condition, not a
reason to add fallback behavior.

## Phase 3: Frontend Feed and Retained Presentation State

Status: **Complete.**

Accept the strict wire fact and route it through the existing cheap same-generation presentation
path.

### Deliverables

- Add `physics.translucency` to `dynamicEntityViewSchema` as a finite number in `0.0..=1.0`.
- Update TypeScript `DynamicEntityView` fixtures and harness sources explicitly. Prefer shared test
  builders where a domain already has one; do not make the production schema optional to reduce
  fixture churn.
- Include translucency in `dynamicPresentationStateIdentity` so a same-generation value change is
  observed.
- Extend `DynamicEntityPresentationState` with required translucency and pass the complete composite
  through `#applySpawnedPresentationState`.
- Keep translucency out of:
  - `dynamicVisualKey`;
  - `DynamicPresentationSource`'s immutable visual facts unless installation sequencing proves a
    separate non-fingerprinted initial-state input is required;
  - `sourceFingerprint` and `objectVisualTemplateKey`;
  - material/texture identities.
- If an installation-time value must accompany staged entities, introduce a narrowly named
  per-resident initial presentation state beside `DynamicPresentationSource`, not inside the shared
  visual template source. This prevents identical visuals at different opacities from fragmenting
  template reuse.

### Acceptance Criteria

- Feed decoding accepts 0, 0.5, and 1 and rejects missing, non-finite, negative, and above-one
  translucency.
- An unchanged translucency level does no retained presentation work.
- A changed level does not alter visual keys, stage a template owner, fetch content, or replace a
  scene node.
- Deferred entities retain the latest accepted translucency and apply it when eventually realized.
- Attached children use their own object translucency; they do not inherit the parent's value unless
  a separately proven hierarchical runtime command requests that behavior.

### Task Checklist

- [x] Extend strict feed schema and fixtures
- [x] Extend mutable presentation identity and state
- [x] Preserve visual-template sharing
- [x] Cover installed, deferred, and attached same-generation paths

### Decisions and Course Corrections

- The strict feed requires the field and accepts only finite `0..=1`. Synthetic and authored
  non-entity dynamics state their zero baseline explicitly; production decoding has no optional
  fallback.
- `DynamicEntityPresentationState` moved beside `PlacedDynamicPresentationSource`, collapsing the
  prior system-local type and giving staged residents one complete non-fingerprinted initial state.
  Immutable `DynamicPresentationSource` and every visual/template key remain unchanged.
- Installed and deferred same-generation runtime tests retain the latest level without another
  visual load. Attached children carry their own initial state through the same adapter/system
  contract.
- Existing diagnostic debt discovered but not expanded in scope: `listPresentedSpawnedEntities`
  claims every realized entity but filters attached children because its placement accessor accepts
  only scene roots. The translucency path does not rely on that diagnostic; fixing its API is an
  independent attachment-inspection task.

## Phase 4: Effect Initialization and Runtime Application

Status: **Complete.**

Make object translucency the initial state of every part, then allow existing behavior commands to
operate on that state.

### Deliverables

- Extend `EffectSystem.install` or introduce an explicit installation value object containing part
  count and initial object translucency. Prefer the value object if another independent initial
  effect fact is required during implementation; otherwise keep the narrower signature.
- Initialize every `partTranslucencies` entry from the object value instead of hardcoded zero.
- Install that state before any animation, motion, default-script, or replay command can target the
  effect owner.
- Add one whole-object presentation-state update operation for same-generation property changes. It
  updates the existing state rather than reinstalling it and follows the Phase 0 retail-proven cloak
  and in-flight-ramp semantics.
- Keep `applyTransparentPart` as the part-local command. Do not reinterpret its authored `start` and
  `end` relative to object translucency; retail supplies absolute translucency values.
- Continue using `DynamicEntitySystem`'s existing contribution expansion:
  - `translucency == 1` emits no draw;
  - otherwise instance alpha is `1 - translucency`;
  - nonzero part translucency promotes opaque ordering to transparent;
  - already alpha-test, transparent, or additive source orderings retain their existing policy.
- Do not add a renderer uniform, shader variant, draw-unit clone, or per-WCID branch.

### Acceptance Criteria

- WCID-like initial `0.5` state gives every part alpha `0.5` before any hook fires.
- Exact `1.0` suppresses all parts without converting `NoDraw` into a second source of truth.
- A `TransparentPart` hook changes only its addressed part and can retain an in-flight ramp.
- Surface opacity and object opacity multiply in the existing shader path.
- A nonzero object level promotes otherwise opaque contributions into the existing transparent
  sorting path in flat and portal rendering.
- Same-generation updates change rendered alpha without changing draw-unit identity, batch key,
  template identity, texture residency, or node identity.
- Existing cloak tests continue to pass with the new object baseline.

### Task Checklist

- [x] Seed effect state from object translucency
- [x] Add proven whole-object update semantics
- [x] Preserve `TransparentPart` precedence and ramps
- [x] Prove contribution ordering, alpha, and suppression
- [x] Prove resource and identity stability

### Decisions and Course Corrections

- `EffectSystem.install` takes one explicit initial translucency scalar; no value object was added
  because part count and translucency are the only independent installation facts.
- Whole-object updates fill current part levels but deliberately retain part-local ramps. The next
  semantic step continues each active ramp from its authored absolute timeline, matching the
  existing `TransparentPart` ownership rather than inventing object-relative composition.
- Initially cloaked residents seed zero because retail applies state before its initial PhysicsDesc
  translucency write. Later writes while cloaked are skipped and are not replayed on uncloak.
- The final quality pass tightened that transition to require both the previous and next states to
  be uncloaked before applying a changed value. Checking only the next state incorrectly replayed a
  suppressed value when an uncloak snapshot carried a different value.
- System tests prove initial 0.5 alpha/order promotion, exact-one suppression, stable node/draw-unit/
  geometry identity across updates, and the retail cloak transition. Effect tests prove per-part
  initialization, addressed-part override, and in-flight-ramp retention.

## Phase 5: Production Verification

Status: **Complete.**

Verify the real catalog/host/browser vertical slice and the Client projection path.

### Deliverables

- Run focused Rust suites for:
  - `holtburger-weenie-catalog`;
  - `holtburger-tools` exporter projection;
  - `holtburger-core` dynamic definitions and client views;
  - `holtburger-3d-host` Explorer driver/delivery.
- Run focused TypeScript suites for:
  - feed decoding;
  - dynamic presentation adaptation/runtime state;
  - effect system;
  - dynamic entity system;
  - renderer compiled-object/contribution behavior.
- Run project checks in the owning package-manager scripts:
  - `cargo test` for affected crates;
  - `cargo clippy ... -- -D warnings` for affected Rust targets;
  - `npm run check`;
  - `npm run lint`;
  - `npm run test:ts` or the focused suite followed by the full suite.
- Exercise the real Explorer catalog host and GPU renderer:

  ```bash
  npm run harness:browser -- \
    --gpu \
    --spawn-wcid 1758 \
    --spawn-distance 5 \
    --screenshot /tmp/holtburger-shadow-1758.png
  ```

- Inspect the screenshot and machine-readable browser evidence. Confirm exact spawn/despawn cleanup
  and absence of browser/WebGL errors.
- Verify Client mode with a captured or synthetic hydrated `ObjectDescriptionData` carrying
  translucency 0.5 if a live Shadow is not deterministically available. Do not use the interactive
  TUI client.

### Acceptance Criteria

- The real Explorer host reports/project WCID 1758 translucency as `0.5`.
- Shadow renders visibly at approximately 50% opacity rather than opaque.
- Client and Explorer reach the same frontend state for the same source fact.
- Full-translucency synthetic content is suppressed.
- Transparent ordering and portal rendering produce no errors or opaque-pass leakage.
- Spawn/despawn resource counts return to baseline.
- All affected tests, checks, formatting, and clippy pass with no ignored warnings.

### Task Checklist

- [x] Run focused Rust tests
- [x] Run focused and full frontend tests/checks
- [x] Run clippy with warnings denied
- [x] Capture and inspect WCID 1758 Explorer evidence
- [x] Verify the Client hydration/projection vertical slice
- [x] Verify resource cleanup

### Decisions and Course Corrections

- Catalog/tool library tests pass (22/31), core passes 331 tests, and the 3D host passes 260 tests.
- The complete frontend suite passes 1,878 tests across 247 files. `npm run check` and `npm run
  lint` pass, including Svelte/TypeScript validation, ESLint, dead-code inspection, and host clippy
  with warnings denied.
- The real GPU browser harness on an RX 7900 XT/Vulkan projected WCID 1758 with translucency 0.5,
  submitted all 69 visible part contributions through transparent ordering, and captured
  `/tmp/holtburger-shadow-1758.png`. Browser console evidence contains only Vite connection
  messages; application error state is null.
- Harness despawn returned spawned entities, visible dynamic entities, resident effect states,
  dynamic templates, and animation reference count to zero. The initial/spawned/despawned evidence
  is retained in `/tmp/holtburger-shadow-1758-harness.log` for this work session.
- A focused world hydration test now constructs `ObjectDescriptionData { translucency: Some(0.5) }`
  and proves it becomes `PropertyFloat::Translucency`; the Client projection parity and update tests
  then prove that hydrated property reaches the same 0.5 view contract.

## Phase 6: Cleanup and Vocabulary Sweep

Status: **Complete.**

Leave the state model intentional after the cross-language contract change.

### Deliverables

- Remove any temporary probes or diagnostics that do not improve the canonical harness.
- Sweep touched code for hardcoded zero translucency defaults that now conceal missing producer
  state. Retain zeros only where the source truly has no object authority, such as explicit
  synthetic/portal fixtures, and name that fact in the fixture.
- Ensure new fields and non-obvious cloak/replay precedence carry professional comments and retail
  citations.
- Confirm `translucency`, `opacity`, and `alpha` vocabulary remains precise:
  - source/runtime state is translucency;
  - draw modulation is opacity/alpha;
  - no symbol calls a material transparent merely because one entity instance currently is.
- Review the final diff for accidental edits to the pre-existing dirty
  `apps/holtburger-3d/src/lib/frontend-tuning.ts` and the ACE/ACViewer submodule worktrees.
- Update this plan's phase statuses, decisions, evidence, and any remaining debt during execution.

### Acceptance Criteria

- No compatibility shim, WCID exception, duplicated alpha pipeline, or dead transition path remains.
- Every new field has a named runtime consumer and every validation clause has a reaching test.
- Touched code is formatted and no unrelated user work is included.

### Task Checklist

- [x] Remove temporary diagnostics
- [x] Sweep hidden zero defaults and terminology
- [x] Review comments and retail citations
- [x] Review final diff and worktree boundaries
- [x] Record final evidence and remaining debt

### Decisions and Course Corrections

- The one diagnostic change was retained intentionally: `weenie_motion_facts` now reports the
  catalog's authored translucency and improves the canonical per-WCID inspection tool. No temporary
  Shadow-specific executable or runtime log survived.
- The remaining zero on an active part is explicitly documented as staging-only state replaced by
  the required effect sample before publication. Authored non-entity dynamics state zero explicitly;
  producer-backed entities never rely on a frontend fallback.
- The retail quirk comment includes decompile lines, observable consequence, and the available
  census. Vocabulary consistently uses source/runtime translucency and draw alpha/opacity.
- Final diff and status review preserved the user's independent `frontend-tuning.ts` change and the
  pre-existing ACE/ACViewer submodule worktree state. No files were staged or committed.
- Remaining debt is unrelated to rendering correctness: the pre-existing
  `listPresentedSpawnedEntities` diagnostic omits attached children as recorded in Phase 3.

## Risks and Mitigations

### Catalog Version Cutover

**Risk:** v10 makes the current v9 local catalog unreadable, temporarily disabling Explorer spawn
until regeneration.

**Mitigation:** Land model, exporter, codec, version, durable documentation, and regenerated local
artifact in one phase. Verify WCID 1758 immediately after export. Do not add backward decoding.

### Initialization After Behavior Replay

**Risk:** Applying object translucency after initial animation/script replay would overwrite valid
part-local `TransparentPart` state.

**Mitigation:** Install the object baseline in `EffectSystem` before producers activate or replay.
Lock this order with a test that begins at 0.5 and then changes one addressed part.

### Visual Cache Fragmentation

**Risk:** Adding translucency to `DynamicPresentationSource` fingerprints or `dynamicVisualKey`
would produce redundant geometry/material templates for visually identical setups.

**Mitigation:** Carry it as per-resident mutable presentation state and explicitly assert stable
visual/template identity across a same-generation translucency change.

### Cloak and Update Precedence

**Risk:** A naive whole-object setter could overwrite the render state retail intentionally freezes
while cloaked, or fail to restore the proper level afterward.

**Mitigation:** Prove the retail transition before implementation, update the entire composite state
atomically, and preserve the existing cloak tests. Do not invent cloak opacity.

### Object and Surface Translucency Conflation

**Risk:** Folding the object value into `ResolvedMaterial.translucency` would mutate shared material
identity, double-apply some sources, and prevent per-entity opacity changes.

**Mitigation:** Keep the source values separate through contribution construction. Assert the final
alpha multiplication using a translucent surface on a translucent entity.

### Fixture Churn Hiding Missing Data

**Risk:** The required cross-language field touches many direct fixture literals, encouraging an
optional schema field or implicit default that would recreate the original omission.

**Mitigation:** Keep the production contract required, consolidate domain-local builders, and set
explicit zero only in fixtures whose source intentionally authors none.

### Fully Translucent Content

**Risk:** Treating all nonzero translucency as merely blended would submit 17 author-intended
invisible templates and could leave depth/shadow artifacts.

**Mitigation:** Preserve exact-one suppression and verify both material and depth contribution
behavior. Do not epsilon-clamp the authored value below one.

## Definition of Done

- [x] `WeenieTemplate` and `.hwc` v10 losslessly preserve optional ACE object translucency
- [x] A freshly exported catalog reports WCID 1758 translucency `0.5`
- [x] Explorer and Client normalize absence to required runtime `0.0`
- [x] Both producers reject invalid translucency through named errors
- [x] `DynamicEntityView` carries one current translucency level through the strict frontend schema
- [x] Initial effect state applies the level to every setup part before behavior replay
- [x] Same-generation updates alter presentation without rebuilding or reacquiring visuals
- [x] `TransparentPart`, cloak, surface opacity, transparent ordering, and exact-one suppression have
      focused tests
- [x] WCID 1758 renders at approximately 50% opacity in the real browser harness
- [x] Client hydration/projection produces the same 0.5 state
- [x] Spawn/despawn cleanup returns resource ownership to baseline
- [x] Affected Rust tests, TypeScript tests, type checks, ESLint, formatting, and clippy all pass
- [x] Producer adapters validate the binary64 source domain before narrowing to binary32
- [x] No renderer/material special case, compatibility shim, or WCID-specific branch is introduced
- [x] The final diff excludes unrelated user and submodule changes

## Open Questions

No product or implementation decision remains open for this fix.
