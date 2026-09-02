# Holtburger 3D Minimap Breadcrumb Trail Plan

Status: **Complete — user accepted and final verification passed (2026-09-02).**

Origin: rename the shared HUD map component so its ownership is explicit, then add a bounded,
spatially sampled history of the controlled entity's movement. The primary use case is retracing a
route through visually repetitive dungeon corridors, while retaining useful behavior outdoors and
when the minimap is panned.

## Context and Boundaries

### Goal

Establish an honest minimap-specific component boundary and add a cheap, legible breadcrumb trail
that records continuous controlled-entity travel without promoting presentation history into shared
game state.

### In scope

- Rename the `MapPanel` component family to `Minimap` with a clean cutover across active source,
  tests, browser-harness selectors, and current UI terminology.
- Preserve the generic `lib/game/map` vocabulary for reusable overhead-map projection, geometry,
  appearance, and WebGL rendering.
- Move minimap interaction tuning out of generic map appearance ownership.
- Record a bounded, recency-ordered history of spatially separated controlled-entity positions.
- Refresh already-covered space without consuming more history capacity.
- Use separate indoor and outdoor sample spacing so dungeon paths retain more detail than outdoor
  travel.
- Detect discontinuous movement from consecutive observations and begin a new trail instead of
  combining unrelated journeys.
- Render breadcrumbs on the existing Canvas2D overlay below live entity blips, using the exact
  `ProjectedMapView` used by other overlays.
- Bound Canvas state changes independently of retained sample count by batching circles into a
  small fixed set of age/elevation presentation buckets.
- Show breadcrumb height relative to the current subject through the map's existing elevation
  brightness language.
- Keep recording while the minimap is panned; zoom, rotation, and re-anchoring affect projection,
  not stored history.
- Add focused policy tests and browser-harness coverage for lifecycle and mechanically observable
  presentation behavior, then hand final visual acceptance to the user.

### Out of scope

- Protocol, `holtburger-core`, `holtburger-world`, or authoritative scene-state changes. A
  breadcrumb is frontend history, not a fact transmitted by the server.
- Persistent history across page reloads, component unmounts, logout, or a new presentation
  session.
- A free-camera trail in Explorer. The requested history is where the controlled entity has been;
  camera navigation is a different UX feature.
- A connected polyline, route finding, fog of war, waypoint editing, breadcrumb interaction, or
  tooltips.
- Retrofitting completed historical plan documents solely to rename symbols they accurately record
  at the time. Active source, tests, current documentation, and UI vocabulary receive the clean
  cutover.
- A new shared abstraction for the WebGL renderer's interior-component selection. Breadcrumbs use
  elevation treatment in the first version; component filtering is deferred unless real stacked-
  dungeon evidence shows unacceptable ambiguity.

## Ground Truth and Existing Seams

Verified against the codebase on 2026-09-02. No ACE or retail-decompile investigation is required:
this is local presentation behavior, not protocol or retail compatibility behavior.

- `apps/holtburger-3d/src/app/MapPanel.svelte` is the shared HUD minimap mounted by both
  `client/ClientWorldView.svelte` and `explorer/ExplorerApp.svelte`. It already owns transient pan
  state, rendering cadence, overlay drawing, marker hit testing, compass chrome, and reset behavior.
- `apps/holtburger-3d/src/app/map-panel-frame.ts` defines the shell-to-widget contract. Its
  `MapPanelSubject` discriminates controlled entities from Explorer's free camera and supplies one
  coherent world position, height, heading, and `SceneResidency`.
- `apps/holtburger-3d/src/lib/game/map/map-view.ts` separates the live `MapAnchor` from the panned
  `MapCenter` and binds each view to its exact `MapWorldToClip` transform as `ProjectedMapView`.
  Historical world points can therefore use the same projection as terrain and blips without
  reimplementing pan, zoom, or rotation.
- `apps/holtburger-3d/src/app/map-pan-policy.ts` is the precedent for keeping transient minimap
  interaction policy in a small stateless module adjacent to the component.
- `apps/holtburger-3d/src/lib/game/map/map-blips.ts` and `MapPanel.svelte::drawBlips` establish the
  Canvas2D overlay path. Breadcrumbs are not entities and must not enter `MapEntity`, radar
  visibility, semantic blip categories, names, or hit targets.
- `apps/holtburger-3d/src/lib/game/map/map-appearance.ts` currently validates and exports
  `MAP_AUTOMATIC_REANCHOR_DISTANCE_METERS`. That value is minimap navigation policy, not reusable
  map-renderer appearance; the rename should correct this ownership rather than adding more widget
  policy to that module.
- `apps/holtburger-3d/src/lib/frontend-tuning.ts` and `frontend-tuning-contract.ts` are the authored
  frontend tuning seam. The current `map.navigation` section should move to a root `minimap`
  section together with breadcrumb policy and appearance, while terrain, surfaces, height ramps,
  blips, and zoom remain under `map`.
- `apps/holtburger-3d/src/harness/browser/ClientHudHarness.svelte` already drives minimap pan,
  reset, subject travel, zoom, coordinate, and FOV behavior. Its current `.map-panel-*` selectors
  are part of the rename census and it is the narrowest browser acceptance seam for breadcrumbs.
- `apps/holtburger-3d/src/client/client-hud-layout.ts` names the HUD placement `map` and its default
  size `CLIENT_MAP_PANEL_SIZE`. Because this is specifically the HUD minimap, these active layout
  names should become `minimap` and `CLIENT_MINIMAP_SIZE`; there is no compatibility alias.

## North Stars

1. Breadcrumbs answer “where did I walk?” without becoming a second world-state model.
2. Dungeon routes deserve denser evidence than outdoor routes because their useful spatial scale is
   smaller.
3. Sampling depends on distance, not render cadence, so frame rate cannot manufacture clustered
   history.
4. The viewed center and the tracked subject remain independent: panning never pauses or relocates
   history.
5. Every historical point goes through the same projection and elevation vocabulary as the map
   beneath it.
6. A bounded small collection deserves a simple bounded array before a custom circular-buffer
   abstraction.
7. “Minimap” names widget state and interaction; “map” names reusable overhead-map mechanics.
8. A discontinuity starts a new truthful trail rather than preserving visually plausible fiction.
9. The history bound must not silently become an equal number of Canvas paint/state-change calls.
10. Repeated combat movement through one room must not evict genuinely novel route history.

## Settled Design

### Ownership

```text
Client/Explorer presentation
        |
        | readMinimapFrame(): current source, subject, entities, camera
        v
app/Minimap.svelte
        |-- owns transient trail and pan state
        |-- samples at display cadence
        |-- projects and draws Canvas2D overlays
        |
        +--> app/minimap-pan-policy.ts
        |       stateless detach/re-anchor policy
        |
        +--> app/minimap-breadcrumb-trail.ts
        |       stateless sampling, lifecycle, and bounded retention policy
        |
        +--> app/minimap-tuning.ts
                validates widget interaction and breadcrumb tuning

lib/game/map/*
        reusable overhead-map projection, geometry, WebGL rendering, and map appearance
```

The component owns the trail because the trail is transient widget presentation. The shell owns
layout and remembered indoor/outdoor zoom because those are already controlled state. Neither shell
owns breadcrumb mutation, and no shared crate receives breadcrumb types.

### Trail model

`minimap-breadcrumb-trail.ts` will define a discriminated state with no partially initialized
fields:

- `empty`: no controlled subject is currently trackable.
- `tracking`: controlled GUID, last observed 3D position, and a non-empty recency-first bounded tuple
  of `MinimapBreadcrumb` samples. Tuple index zero is the last recorded position, so that fact is
  derived rather than duplicated in another field.

Each breadcrumb stores `worldX`, `worldY`, and `worldZ`. It does not retain residency unless an
implemented consumer needs it: environment selection is needed when deciding the next sample's
spacing, while rendering needs only position and the current view.

The last observation and last recorded sample remain distinct interdependent facts:

- Consecutive distance from `lastObserved` detects one discontinuous move.
- Horizontal distance from `samples[0]` implements the sampling deadband.

Using only the last recorded sample for both would eventually misclassify ordinary accumulated
movement as a teleport. The pure transition function computes each distance once and returns the
same state when neither observation nor history changes.

### Sampling and retention

- Only a `controlled-entity` subject records breadcrumbs. A null subject, a free camera, or a GUID
  change clears the old trail; a newly controlled entity starts its own trail at its current pose.
- Record after horizontal displacement reaches the environment-specific spatial deadband
  (hysteresis). Turning and vertical animation in place cannot manufacture clustered dots.
- Select indoor spacing when the current subject occupies an EnvCell; otherwise select outdoor
  spacing, matching `mapEnvironment` and its existing unknown-residency behavior.
- Compare consecutive observations in full 3D against one maximum-continuous-step threshold. A
  larger jump replaces the trail with a fresh initial sample. This handles portal recalls,
  teleports, and discontinuous corrections without drawing or retaining unrelated clusters.
- Crossing an ordinary indoor/outdoor doorway does not clear history. Continuous doorway travel is
  valuable route evidence.
- After movement clears the last-sample deadband, compare the candidate in 3D with retained
  samples using the same environment spacing. If it revisits covered space, remove every covered
  sample and prepend the current position. This spatial-LRU refresh preserves recency without
  consuming capacity, compacts overlapping coverage, and keeps vertically separated floors
  distinct.
- Otherwise prepend the novel sample in most-recent-first order. Once capacity is
  reached, discard exactly the oldest tail sample. At the proposed small capacity, an ordinary
  array and at most 128 distance checks per candidate are clearer and amply cheap; introduce a
  spatial index or circular-buffer primitive only if measured workload justifies either.
- Initial tuning is intentionally provisional for user visual verification: 128 samples, 2 m indoor
  spacing, 5 m outdoor spacing, and a 30 m maximum continuous 3D step. Without revisits, those
  spacings represent 256 m of indoor or 640 m of outdoor sampled travel at capacity; spatial
  refreshes retain more route distance by not spending slots on already-covered space.

### Rendering

- Draw breadcrumbs into the existing blip canvas after clearing it and before live entity blips.
  They do not create `BlipHitTarget`s, names, tooltips, or radar categories.
- Project each sample with `projectMapWorldPoint(overlay.worldToClip, overlay.view, ...)` and skip
  points outside the clip-space square; the existing circular disc clips the canvas boundary.
- Draw fixed-pixel-radius circles so zoom changes geographic spacing but not marker legibility.
- Quantize sample age into four monotonic opacity bands from oldest to newest. Age is sample order,
  not wall-clock time, so standing still does not erase the route.
- Brighten or darken each breadcrumb from `sample.worldY - overlay.view.anchor.worldY` using the
  existing indoor/outdoor elevation scale. Extract a generically named map-elevation brightness
  helper from the current blip-specific helper rather than duplicating its rule, then quantize the
  breadcrumb result into below/same/above brightness bands. Blips retain their continuous
  brightness treatment.
- Give every circle a dark age-faded halo around its bright elevation-colored core. The dual-tone
  marker provides a dark boundary on pale floors and a bright center on dark floors without
  sampling WebGL terrain pixels or making the authored core color responsible for every scheme.
- Batch every core sharing one age-opacity and elevation-brightness pair into one Canvas fill, then
  batch all halos of one age into one Canvas stroke. Four age bands crossed with three elevation
  bands cap core drawing at 12 fills; four age halos bring the total to at most 16 paint calls and
  associated style changes per overlay repaint, regardless of whether the trail holds 12 or 128
  samples. Samples contribute one core and one halo `arc()` path segment but are projected only
  once; they add no WebGL draw calls, buffers, shader programs, uploads, or readbacks.
- Keep the live controlled arrow and ordinary blips above the trail. The trail remains visible
  during detached panning and naturally follows current zoom and heading because it stores world
  positions rather than screen positions.
- Use discrete indicators with no connecting stroke. This prevents a discontinuity from producing
  a false corridor even before lifecycle policy runs and avoids dense route spaghetti.

## Phase 1: Clean Minimap Naming and Ownership Cutover

### Deliverables

- Rename:
  - `app/MapPanel.svelte` to `app/Minimap.svelte`.
  - `app/map-panel-frame.ts` and its test to `app/minimap-frame.ts` and
    `app/minimap-frame.test.ts`.
  - `app/map-pan-policy.ts` and its test to `app/minimap-pan-policy.ts` and
    `app/minimap-pan-policy.test.ts`.
- Rename the full `MapPanel*` symbol family to `Minimap*`, including GPU draw-state helpers,
  minimum size, shell callbacks, local state, props, and update functions.
- Rename component CSS classes, SVG clip-path identifiers, browser-harness selectors/results, and
  active comments from `map-panel-*` to `minimap-*`.
- Rename `ClientHudLayout.map` to `minimap` and `CLIENT_MAP_PANEL_SIZE` to
  `CLIENT_MINIMAP_SIZE`, updating focused layout tests and consumers.
- Add `app/minimap-tuning.ts`; move automatic re-anchor validation/export out of
  `lib/game/map/map-appearance.ts`.
- Move authored `map.navigation` tuning to root `minimap.navigation` in both the tuning object and
  contract. Leave generic renderer appearance, blips, height ramps, and zoom under `map`.
- Do not add forwarding exports, deprecated aliases, duplicate CSS selectors, or compatibility
  shims.

### Task checklist

- [x] Use filesystem moves, then update imports and symbols in one compile-preserving cutover.
- [x] Rename the controlled component prop from generic `panel` to `viewState`; plain `state`
      conflicts with Svelte's `$state` rune namespace.
- [x] Update Client, Explorer, presentation-session, and harness frame producers to
      `readMinimapFrame`.
- [x] Update focused tests without weakening their assertions.
- [x] Run a case-sensitive vocabulary census over active app source and current documentation.
- [x] Run formatting, `npm run check`, focused renamed tests, and the client-HUD browser harness.

### Acceptance criteria

- The Client and Explorer mount `Minimap` and retain identical pre-breadcrumb behavior.
- Active source and tests contain no `MapPanel`, `map-panel`, `readMapPanelFrame`, or
  `CLIENT_MAP_PANEL_SIZE` vocabulary.
- Generic `MapRenderer`, `MapViewParameters`, and `lib/game/map` names remain unchanged.
- The automatic re-anchor knob has one app-local minimap consumer and no longer flows through map
  appearance.
- Type checks, focused tests, and existing pan/reset/FOV browser scenarios pass.

### Decisions and course corrections

- Completed 2026-09-02. The clean cutover renamed the component, frame/pan modules, symbol family,
  CSS/SVG identifiers, Client HUD layout key, shell frame producers, and browser-harness evidence.
  Generic `lib/game/map` renderer/projection vocabulary remained unchanged.
- Added `app/minimap-tuning.ts` and moved the automatic re-anchor setting from `map.navigation` to
  root `minimap.navigation`; `map-appearance.ts` no longer owns widget navigation policy.
- Concession: the planned `state` prop name is invalid in a Svelte runes component because it
  shadows `$state` and is parsed as a store binding. `viewState` is the honest non-conflicting name;
  no diagnostic suppression or alias was introduced.
- Evidence: `npm run check` passed with 0 Svelte errors/warnings; four focused files passed 55
  tests; `npm run harness:browser -- --client-hud --brief` passed with only Chromium environment
  diagnostics and Vite debug console messages. The active source census found no old `MapPanel`,
  `map-panel`, `readMapPanelFrame`, or `CLIENT_MAP_PANEL_SIZE` vocabulary.
- Debt carried forward: none from the rename. Completed historical plan references remain
  intentionally untouched under the plan's out-of-scope rule.

## Phase 2: Implement the Stateless Breadcrumb Policy

### Deliverables

- Add `app/minimap-breadcrumb-trail.ts` with documented trail/sample types and a pure observation
  transition.
- Add `app/minimap-breadcrumb-trail.test.ts` covering the behavior matrix.
- Extend root `minimap` tuning with validated breadcrumb capacity, spacing, discontinuity,
  appearance, and opacity values.
- Add the narrow converted constants needed by the component to `app/minimap-tuning.ts`.

### Task checklist

- [x] Define `empty` and `tracking` state variants so no assertion or fallback is required.
- [x] Seed a new trail for the first controlled subject observation.
- [x] Update consecutive observation state without sampling below the current environment's
      spacing threshold.
- [x] Record at the threshold and preserve most-recent-first ordering.
- [x] Evict exactly the oldest sample at capacity.
- [x] Reset and seed on controlled GUID change or excessive consecutive 3D displacement.
- [x] Clear on null/free-camera input and preserve continuous indoor/outdoor doorway travel.
- [x] Import production tuning in tests; do not duplicate runtime constants as magic numbers.

### Acceptance criteria

- Unit tests prove minimum spatial separation, independent observation/record positions,
  indoor/outdoor thresholds, bounded replacement, revisit compaction, discontinuity reset, subject
  lifecycle, and unchanged-state behavior.
- The policy imports no Svelte, canvas, renderer, protocol, core, or world-state owner.
- Capacity and every threshold have one named scenario in which they affect behavior.

### Decisions and course corrections

- Completed 2026-09-02. Added `minimap-breadcrumb-trail.ts` as a pure transition over an injected
  `MinimapBreadcrumbPolicy`; it imports no Svelte, Canvas, renderer, protocol, core, or world-state
  owner.
- Replaced the draft's separate `lastRecorded` field with a non-empty recency-first tuple whose
  first element is the latest recorded sample. This removes duplicated interdependent state and
  lets TypeScript prove the sample exists without an assertion or fallback. Rendering iterates the
  tuple in reverse when oldest-first painter order matters.
- Added and validated the provisional production tuning: 128 samples, 2 m indoor spacing, 5 m
  outdoor spacing, 30 m maximum continuous 3D step, pale route ink, 1.75 px radius, and 0.18-0.72
  age opacity. Visual values remain explicitly provisional for Phase 5 user acceptance.
- Evidence: the three focused policy/frame files passed 22 tests; `npm run check` passed with 0
  Svelte errors/warnings and all TypeScript configurations clean.
- Debt carried forward: none. The discontinuity threshold remains a tuning hypothesis, not hidden
  technical debt, and is called out at the final user gate.

## Phase 3: Integrate and Render the Trail

### Deliverables

- Add transient `MinimapBreadcrumbTrail` ownership to `Minimap.svelte`.
- Advance the trail from the same imperative `MinimapFrame` snapshot used by the current animation
  step.
- Add breadcrumb drawing to the existing Canvas2D overlay before entity blips.
- Generalize the existing elevation-brightness primitive and reuse it for blips and breadcrumbs.
- Batch breadcrumb cores into the fixed four-age-by-three-elevation style grid and halos into four
  age paths, issuing at most 16 Canvas paint calls per overlay repaint.
- Extend the client-HUD browser harness with deterministic subject movement, environment, and
  discontinuity controls plus breadcrumb visual scenarios.

### Task checklist

- [x] Observe the subject once per display step, independently of the 30 Hz WebGL terrain cap.
- [x] Keep trail state out of Svelte reactivity unless markup has a real consumer.
- [x] Draw only in-view samples with fixed-pixel size, age opacity, and relative-height brightness.
- [x] Project each visible sample once, assign it to one of the 12 fixed core-style buckets, and
      reuse those coordinates for one age-halo stroke plus the non-empty core fills.
- [x] Ensure breadcrumbs never enter blip hover targets and remain below the controlled arrow.
- [x] Verify recording continues while panned and remains stable across the shared projection's
      pan, zoom, and heading inputs.
- [x] Exercise ordinary doorway environment changes without clearing and discontinuities with a
      reset.
- [x] Leave deterministic harness controls and a concise inspection checklist for the user's final
      visual verification.

### Acceptance criteria

- A moving controlled entity leaves spatially separated dots; standing or turning in place adds
  none.
- More than the configured capacity programmatically retains only the newest samples; visual
  capacity acceptance is deliberately excluded because evicted history is generally offscreen and
  cannot be inferred honestly from Canvas pixels.
- Indoor movement records more densely than outdoor movement over the same distance.
- Panning does not stop sampling; pan reset, automatic re-anchor, zoom, and rotation project the
  same stored world trail coherently.
- Above/below breadcrumbs remain distinguishable without introducing a second elevation rule.
- Breadcrumb overlay rendering performs no more than 16 paint/style changes for a full trail and
  adds no WebGL draw call, upload, or readback.
- Null/free-camera/identity/discontinuity lifecycle changes never display an unrelated prior trail.
- The existing minimap, blip, tooltip, FOV, pan, reset, and resize scenarios remain correct.

### Decisions and course corrections

- Completed 2026-09-02. Added `minimap-breadcrumb-renderer.ts`, a narrow Canvas adapter separate
  from both the Svelte component and history policy. It projects each visible sample once into a
  flat coordinate bucket, then draws oldest-first through four age bands crossed with below/same/
  above elevation bands.
- Generalized `mapBlipBrightness` to `mapElevationBrightness` and extracted the shared channel-byte
  conversion. Entity blips retain continuous brightness; breadcrumbs quantize the same result to
  three bounded style bands rather than deriving another height rule.
- Breadcrumbs render whenever a coherent controlled subject exists, even if terrain source
  publication is temporarily absent. The Canvas overlay is presentation history and does not need
  to disappear merely because the independent WebGL terrain source is unavailable; live entity
  blips preserve their existing source gate.
- Corrected age bucketing so a non-empty trail always maps its newest sample to the newest opacity
  and its oldest sample to the oldest opacity, even when fewer than four samples exist.
- Browser harness evidence originally used non-transparent pixels from the dedicated minimap
  overlay canvas rather than production debug counters. The Phase 5 halo revision proved that
  raster area is not invariant under a semantic no-op, so current integration evidence instead
  counts harness-observed Canvas arcs while retaining pixels only as a visible-output smoke check.
- Course correction: bounded replacement is proven in the pure policy suite rather than by a
  misleading visual capacity assertion. Old samples are normally outside the current viewport, so
  Canvas pixels cannot establish which offscreen entry was evicted.
- Evidence: focused trail/renderer/map-appearance tests passed 11 tests; `npm run check` passed with
  0 Svelte errors/warnings; `npm run harness:browser -- --client-hud --brief` passed with only
  Chromium environment diagnostics and Vite debug console messages.
- Debt carried forward: final hue, density, opacity, radius, discontinuity threshold, and stacked-
  floor readability remain user-owned Phase 5 visual questions by design.

## Phase 4: Cleanup and Automated Verification

### Deliverables

- Remove dead imports, stale helpers, old vocabulary, diagnostic-only harness hooks, and accidental
  abstractions discovered during implementation.
- Update current durable documentation only where the resulting ownership or tuning seam needs to
  remain discoverable; keep this plan as temporary execution history.
- Record any newly encountered domain-agnostic design smell in
  `docs/code-quality-audit-patterns.md` only when it is genuinely reusable and not already covered.

### Task checklist

- [x] Review the complete diff for duplicate projection, elevation, identity, sampling, or tuning
      logic.
- [x] Confirm every new type field and tuning value has a named production consumer.
- [x] Confirm no breadcrumb concept escaped the frontend or entered entity/radar semantics.
- [x] Run `git diff --check` and the final vocabulary census.
- [x] Run `npm run check`, `npm run test:ts`, `npm run lint`, and
      `npm run harness:browser -- --client-hud --brief` from `apps/holtburger-3d`.
- [x] Inspect browser console output; treat warnings as failures unless proven environmental and
      pre-existing. Final aesthetic screenshot/gameplay review remains user-owned.

### Acceptance criteria

- The diff reads as one intentional minimap boundary plus one colocated feature, not a component
  rename with breadcrumb exceptions.
- No compatibility aliases, stale active vocabulary, dead fields, inline lint suppressions, or
  unconsumed tuning remain.
- All checks, tests, lint, and client-HUD browser scenarios pass without application warnings.

### Decisions and course corrections

- Completed 2026-09-02. The full diff review kept breadcrumb history, lifecycle, tuning, Canvas
  drawing, and harness policy inside `apps/holtburger-3d`; no breadcrumb type or decision entered a
  shared Rust crate, entity semantics, radar selection, protocol, or authoritative world state.
- Cleanup renamed the now-shared `blipCanvas` surface to `overlayCanvas`, removed stale panel
  terminology from the active minimap family, renamed the current accessible surface to `Minimap`,
  removed a redundant pan guard, and narrowed two renderer-only bucket constants that dead-export
  analysis caught. No compatibility aliases or lint suppressions were introduced.
- The code-quality worksheet was reviewed but not changed. The pass found no new domain-agnostic
  smell not already represented there; private over-export and stale local vocabulary are ordinary
  hygiene issues rather than deserving duplicate audit entries.
- Evidence: `git diff --check` and the old-vocabulary census passed; `npm run check` passed with 0
  Svelte errors/warnings; all 251 TypeScript test files and 1,897 tests passed; ESLint, Knip, and
  Rust clippy with warnings denied passed; the client-HUD browser harness passed all breadcrumb and
  existing minimap assertions.
- Browser output contained only the established Vite debug messages plus Chromium host-environment
  diagnostics for GCM registration, Fontconfig cache version, and zygote shutdown. There were no
  application warnings or errors.
- Debt carried forward: only the explicit Phase 5 visual tuning questions and stacked-floor
  readability. No implementation or automated-verification debt is knowingly deferred.

## Phase 5: User Visual Verification and Resteering

Implementation hands a clean, automatically verified build to the user at this final acceptance
gate. The user performs the visual review; follow-up changes are made only from their reported
evidence rather than the implementer self-accepting the aesthetic result. Any follow-up repeats the
relevant Phase 4 checks before returning here.

### User verification checklist

- [x] Review the implemented capacity and spacings at a representative corridor, intersection,
      doorway transition, ramp, and vertically overlapping passage.
- [x] Confirm breadcrumb density carries turns without forming a nearly solid line.
- [x] Confirm age fading preserves recent route readability while making the oldest history quiet.
- [x] Confirm the dark halo remains distinct on pale dungeon floors while the bright core remains
      distinct on dark and colored terrain.
- [x] Assess whether elevation treatment alone is adequate for stacked dungeon components.
- [x] Accept the result or report concrete evidence for a small follow-up change. Do not expose
      interior-component state merely because it is theoretically available.

### Acceptance criteria

- The user accepts the visual behavior or supplies concrete evidence for revisions.
- Any component-filtering expansion is justified by a reproduced ambiguity and designed around one
  owner of the selected component; the component and renderer must not independently re-derive it.
- Any requested revision returns through automated verification before another visual handoff.

### Decisions and course corrections

- User feedback identified that last-sample hysteresis alone still lets combat laps consume the
  bounded history and evict more important route evidence. The visual gate is temporarily reopened
  for one policy revision: spatially occupied locations refresh in place instead of appending.
- Decision: use the active environment's existing spacing as the 3D occupancy radius. This avoids
  another speculative tuning knob, preserves vertically separated floors, and bounds the scan to
  the already-capped 128 samples. Remove all colliding samples rather than an arbitrary nearest one
  so the operation cannot create overlapping retained coverage.
- Implemented the revision as one filter in the existing pure transition: after the last-sample
  deadband clears, every sample within the current 3D occupancy radius is removed before the
  current position is prepended. A novel position retains the existing capacity eviction path;
  revisited space refreshes recency without growing the collection.
- Tests now prove that a full four-sample history revisits an earlier location without evicting an
  unrelated oldest sample, a midpoint compacts every covered sample, horizontally overlapping
  floors separated by height remain distinct, and twenty combat laps around four occupied
  positions still retain four samples rather than eighty.
- Browser evidence adds a real overlay revisit step: dual-tone arc count drops from eight to six
  when the fixture returns through covered space, then the existing discontinuity, identity,
  free-camera, pan, zoom, and re-anchor scenarios continue to pass.
- Concession: occupancy uses the subject's current environment spacing because samples do not
  retain residency. Turning around just outside an indoor/outdoor boundary can therefore compact
  nearby denser indoor samples using the 10 m outdoor radius. Adding residency or another coverage
  knob is not deserved without visual evidence that this harms doorway readability.
- Evidence: all 251 TypeScript test files and 1,901 tests passed; `npm run check`, ESLint, Knip,
  Rust clippy with warnings denied, `git diff --check`, and the client-HUD browser harness passed.
  Browser output again contained only Vite debug messages and established Chromium environment
  diagnostics.
- Code-quality audit: the semantic sweep changed FIFO/chronological vocabulary to recency and
  spatial-refresh terminology everywhere active. No new domain-agnostic smell was found beyond
  already-documented stale-vocabulary hygiene, so the worksheet was not padded with a duplicate.
- Debt carried forward: user visual acceptance of room density, doorway turnaround detail, and
  stacked-floor readability. No implementation or automated-verification debt is knowingly
  deferred.
- User visual feedback then established that the pale single-color marker is difficult to see
  against the current pale dungeon-floor tuning. A single authored color cannot guarantee contrast
  against arbitrary terrain, so the visual gate is reopened for a dual-tone marker revision.
- Decision: add an explicitly tuned dark halo color and pixel width. Render one combined halo
  stroke per age band around the existing bright, elevation-colored cores. This preserves age and
  height semantics, projects each sample once, avoids WebGL readback/blend-mode coupling, and raises
  the fixed Canvas budget only from 12 fills to 12 fills plus four strokes.
- Implemented `haloColor` as a warm near-black `#17110c` and `haloWidthPixels` as 1 beside the
  existing core tuning. Both pass through the app-local validated minimap adapter; core hue,
  elevation brightness, and age opacity remain unchanged, and the halo fades through the same age
  bands.
- Renderer tests prove every visible sample is projected once, contributes exactly one halo and
  one core arc, and stays within 12 fills plus four strokes. They also verify the exact
  oldest-to-newest painter sequence: one halo followed by the three possible elevation cores for
  each age band.
- Harness course correction: the new halo made non-transparent pixel area vary when the anchored
  breadcrumb shifted subpixel position even though no sample was added. Replaced semantic
  assertions over raster area with harness-only observation of final Canvas arc calls; production
  components and types gained no diagnostic state. Pixel coverage now proves only that output is
  painted or cleared.
- Added the domain-agnostic smell **Presentation Footprint Stands In for Semantic State** to
  `docs/code-quality-audit-patterns.md`, covering tests that infer cardinality or transitions from
  incidental raster, layout, timing, or allocation footprints.
- Evidence: all 251 TypeScript test files and 1,901 tests passed; `npm run check`, ESLint, Knip,
  Rust clippy with warnings denied, `git diff --check`, and the revised client-HUD browser harness
  passed. Browser output contained only Vite debug messages and established Chromium environment
  diagnostics.
- Debt carried forward: user visual acceptance of halo contrast and width alongside the existing
  room-density, doorway-turnaround, and stacked-floor questions. No implementation or automated-
  verification debt is knowingly deferred.
- User accepted the final visual behavior and the current tuning surface. The spatial LRU is
  tunable through `maximumSamples` and the shared indoor/outdoor `spacingMeters`; there is no
  separate occupancy radius. Final user-tuned values are a `#878787` core, 5 m indoor spacing,
  and 10 m outdoor spacing; the halo remains `#17110c` at 1 pixel.
- Accepted concession: `spacingMeters` governs both the horizontal recording deadband and the 3D
  revisit radius. This is a deliberate YAGNI coupling for the observed distribution, not an
  invariant. If dense corridor sampling and more aggressive room suppression need different
  values, split an independently named coverage radius rather than adding hidden multipliers.
- Added the domain-agnostic smell **One Knob Governs Independent Behaviors** to
  `docs/code-quality-audit-patterns.md`. The worksheet explicitly treats evidence-backed first-
  version coupling as a valid counterexample, so recording the smell does not manufacture an
  abstraction without a demonstrated divergent calibration.
- Final code-quality pass removed stale value-derived tuning prose, censused old active
  `MapPanel` vocabulary and every new tuning consumer, and reviewed the complete diff by owner.
  The final browser pass exposed a harness scenario that assumed breadcrumb spacing remained below
  the independently tuned automatic re-anchor distance. It now records the panned breadcrumb in
  the indoor fixture, while the following scenario independently proves automatic re-anchoring.
- Added the domain-agnostic smell **Test Scenario Relies on Accidental Tuning Order** to
  `docs/code-quality-audit-patterns.md`. The corrected browser harness passed, followed by a clean
  repeat of all 251 TypeScript test files and 1,901 tests, `npm run check`, ESLint, Knip, and Rust
  clippy with warnings denied. No implementation debt is knowingly deferred.

## Risks and Mitigations

- **Stacked dungeon floors can overlap in horizontal projection.** Reuse relative-height brightness
  first and validate against real dungeon cases. If ambiguity remains, expose one already-computed
  visible-component fact through a narrow map-renderer contract; never run a second portal flood in
  the overlay.
- **A backgrounded tab can observe a large legitimate displacement on resume.** The discontinuity
  rule intentionally favors a fresh truthful local trail over retaining uncertain history. Keep the
  threshold tunable and judge it against actual maximum continuous movement during harness work.
- **Sampling from display cadence can lose curve detail at very sparse frames.** Threshold against
  world displacement, not elapsed frames or accumulated sample steps. Cadence may change the exact
  sampled point after a threshold crossing, but it cannot create sub-threshold clusters; this is a
  deliberately approximate trail rather than movement telemetry.
- **Backtracking can revisit old breadcrumbs.** Refresh covered samples to the newest position
  rather than rejecting the observation or appending a duplicate. This preserves evidence and
  recency without spending another capacity slot. Use 3D proximity so vertically overlapping
  passages do not suppress each other.
- **The rename can miss string selectors or layout vocabulary.** Census exact old spellings after
  the cutover and run the browser harness, whose selectors exercise the DOM names.
- **Component-local ownership clears history on unmount.** This is intentional v1 lifecycle. If
  users later require HUD reconstruction persistence, lift the complete trail session to the
  composing shell rather than introducing storage from inside the component.
- **Canvas overdraw can make coincident points brighter.** Draw oldest to newest with authored
  opacity bands and evaluate backtracking visually. With at most 128 small dual-tone circles and 16
  batched paint calls, performance is not the limiting concern; legibility is.

## Definition of Done

- [x] The shared widget and its active contracts consistently use `Minimap` terminology.
- [x] Generic overhead-map renderer/projection modules retain truthful `map` terminology.
- [x] Minimap navigation and breadcrumb tuning have one app-local adapter and do not live in map
      appearance.
- [x] Only controlled entities record a bounded, distance-sampled, discontinuity-aware trail.
- [x] Revisiting covered 3D space refreshes recency without consuming another history slot.
- [x] Trail history works indoors, outdoors, across ordinary doorways, and while panned.
- [x] Breadcrumbs fade by sample age, communicate relative height, and remain below live blips.
- [x] Breadcrumb rendering is capped at 16 Canvas paint/style changes per repaint and introduces no
      WebGL draw calls or readbacks.
- [x] Unit tests cover policy invariants and bounded replacement without magic-number copies.
- [x] Browser evidence covers movement, pan, zoom, lifecycle, and environment behavior.
- [x] The user has accepted stacked-dungeon presentation against real content, or any reported
      limitation has been addressed and returned for re-verification.
- [x] Full checks, TypeScript tests, lint including clippy warnings-as-errors, and browser harness
      pass.
- [x] The final diff has received a code-quality pass and contains no old active vocabulary.

## Open Questions

None remain for this implementation. The user accepted the current capacity, coupled sampling and
coverage spacing, discontinuity threshold, dual-tone appearance, age fading, elevation treatment,
and stacked-dungeon behavior. Future retuning remains available through the explicit frontend
tuning seam; independently splitting coverage radius requires concrete evidence that it should
diverge from sample spacing.
