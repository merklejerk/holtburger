# Holtburger 3D Client HUD Layout System Plan

Status: **Complete — Phases 1-5 accepted and verified 2026-09-01.**
Origin: review of the client HUD's resize behavior identified a sound placement kernel surrounded
by decentralized surface geometry and conditional-visibility policy. The toast and jump meter
currently bypass the kernel entirely, while the radar and diagnostics use it through separately
owned placement state.

## Context and Boundaries

### Goal

Make one client-owned HUD layout system authoritative for every configurable in-world UI surface,
including center anchors and an unlocked layout-preview mode that exposes normally transient
surfaces without fabricating gameplay state.

### In scope

- Generalize client HUD anchors independently on each axis from physical edge pairs to
  `start | center | end` alignment plus an offset.
- Preserve the existing resize invariants: surfaces remain reachable, temporarily relax preferred
  dimensions in constrained viewports, and restore their authored dimensions when room returns.
- Consolidate character, chat, frame-rate, shortcuts, radar, jump meter, toast lane, and client
  diagnostics placement into one `ClientHudLayout` value owned by `ClientWorldView`.
- Make the frame-rate display genuinely top-center rather than left-anchored at a launch-time
  coordinate.
- Move the toast and jump meter from fixed viewport CSS into the HUD placement system.
- Replace the inverted `uiLocked` behavior with one explicit runtime/layout presentation mode.
- In layout mode, mount every configurable surface for which the running client has capability,
  using inert representative content for normally hidden transient surfaces.
- Keep the existing UI-lock control fixed and always reachable as editor chrome.
- Retain separate visual chrome for ordinary HUD surfaces, the round radar, and the titled
  diagnostics window while sharing their coordinate physics.
- Add focused unit and browser-harness evidence for anchor resolution, viewport resizing, layout
  preview, dragging, and locked-mode visibility.

### Out of scope

- Moving client layout policy into a shared Rust crate, `holtburger-core`, or Explorer. This is
  frontend control policy and has only one demonstrated consumer.
- Repairing the Explorer map's raw `left/top/size` resize behavior. It is a separate Explorer-local
  layout defect and should not force a universal frontend layout abstraction.
- Persisting layouts across launches. The layout value will remain serializable so a later storage
  adapter is straightforward, but this change adds neither `localStorage` nor host IPC.
- Automatic collision avoidance, docking, grids, snap guides, reset/import/export UI, or profiles.
- Making every surface resizable. Toast, jump, and frame-rate surfaces have no demonstrated
  user-controlled size requirement.
- Changing toast expiry/replacement semantics, jump charging, precise-jump behavior, renderer
  ownership, or any host/protocol contract.
- Treating the UI-lock button or future layout-editor controls as movable HUD surfaces. Editor
  chrome must not be able to hide its own exit path.

## Ground Truth and Existing Seams

The dry run traced every current placement consumer and conditional surface:

- `apps/holtburger-3d/src/client/client-hud-layout.ts`
  - Already owns the correct frontend boundary: canonical placements, viewport resolution,
    clamping, preferred-size restoration, drag re-anchoring, and resize geometry.
  - `ClientHudLayout` currently inventories only character, chat, FPS, and shortcuts.
  - `createDefaultClientHudLayout` simulates FPS centering with a one-time left offset, so it does
    not remain centered after a later resize.
- `apps/holtburger-3d/src/client/client-hud-layout.test.ts`
  - Proves edge anchors, constrained viewports, preferred-size restoration, nearest-edge capture,
    square radar placement, and border resizing. It is the primary deterministic seam for the
    generalized axis math.
- `apps/holtburger-3d/src/client/ClientWorldView.svelte`
  - Correctly observes the actual `.client-world` content box with `ResizeObserver`; layout must
    continue to resolve against that box rather than independently reading global window events.
  - Owns `hudLayout`, `mapPlacement`, and `debugPlacement` as three separate reactive values.
  - Owns the current lock state and is therefore the correct owner of layout-preview policy.
- `apps/holtburger-3d/src/client/ClientHudPanel.svelte`
  - Provides ordinary HUD move/resize handles and consumes resolved absolute geometry.
  - It should remain presentation chrome, not become the owner of layout state or surface
    visibility.
- `apps/holtburger-3d/src/client/ClientHudWindow.svelte`
  - Uses the same placement math but distinct titled-window chrome and all-edge resizing. This is
    evidence that shared coordinate physics does not require one universal visual wrapper.
- `apps/holtburger-3d/src/app/MapPanel.svelte`
  - Is a controlled shared map component with its own round-frame move/resize affordances. The
    client shell already adapts its square geometry through `resolveClientHudSquarePlacement` and
    should keep map view diameters separate from HUD placement.
- `apps/holtburger-3d/src/client/ClientToastOverlay.svelte`
  - Currently owns fixed bottom-center geometry (`left: 50%`, `bottom: 48px`) in addition to toast
    presentation, crossing the intended shell/widget boundary.
- `apps/holtburger-3d/src/client/ClientJumpPowerBar.svelte`
  - Currently owns fixed bottom-center geometry (`left: 50%`, `bottom: 72px`) and conditionally
    removes itself when charge is inactive.
- `apps/holtburger-3d/src/client/client-toast-center.ts`
  - Correctly owns latest-wins toast lifetime. Layout preview must not publish into or otherwise
    modify this owner.
- `apps/holtburger-3d/src/harness/browser/ClientHudHarness.svelte`
  - Already supplies deterministic HUD, jump, toast, and diagnostics fixtures. It is the deserved
    runtime verification surface; the dry run found no need for live ACE state.
- `apps/holtburger-3d/scripts/live-client-ui-probe.mjs`
  - Reads `.client-toast` content. Keeping that semantic class on the content component avoids
    unrelated probe churn.
- `apps/holtburger-3d/AGENTS.md`
  - Classifies panel layout and cold controls as app-local reactive state. No frame-hot input needs
    to enter Svelte as part of this work.

No ACE, ACViewer, or retail-client research is needed: this is deliberate Holtburger frontend
layout policy, not game behavior or retail compatibility.

## North Stars

1. One surface, one canonical placement, one owner.
2. Axis behavior should be isomorphic; horizontal and vertical anchoring must not grow parallel
   special-case implementations.
3. Layout preview presents UI without mutating the gameplay owners that normally make it visible.
4. Components render content and chrome; the client shell owns placement and visibility policy.
5. A smaller viewport may temporarily compromise size or offset, but must never permanently
   rewrite user intent merely because the window was small.
6. Reachability is an invariant; non-overlap and aesthetic arrangement remain user policy.
7. The final vocabulary should say `start`, `center`, and `end` everywhere—no surviving mix of
   `left/right`, `top/bottom`, and pseudo-centered launch coordinates in the canonical model.

## Settled Design

### Canonical axis anchors

Each dimension uses the same shape:

```ts
type ClientHudAxisAlignment = "start" | "center" | "end";

interface ClientHudAxisAnchor {
  readonly alignment: ClientHudAxisAlignment;
  readonly offset: number;
}
```

- `start` offset is inward from the left or top content edge.
- `end` offset is inward from the right or bottom content edge.
- `center` offset is signed displacement between the surface center and viewport center.
- Combining the axes provides all nine anchors: four corners, four edge centers, and screen center.
- Capturing a dragged rectangle compares its start, center, and end reference distances on each
  axis and records the nearest alignment. Switching alignment does not move the rectangle at
  capture time; it only determines how later viewport changes preserve intent.
- Ties resolve deterministically. There is no anchor selector, snap guide, or dead-zone UI in this
  slice; drag capture is the existing interaction extended to three candidates.

### Layout inventory and ownership

`ClientHudLayout` becomes the complete placement contract with named fields for:

- `character`
- `chat`
- `frameRate`
- `shortcuts`
- `map`
- `jumpPower`
- `toast`
- `diagnostics`

Map view diameters, diagnostic open/closed state, current toast, and current jump charge remain
separate because they are content or runtime visibility, not geometry. The immutable debug
capability continues to decide whether diagnostics exists at all.

`createDefaultClientHudLayout` authors every initial placement. The centered defaults are expressed
honestly:

- frame rate: top-center;
- toast: bottom-center at its current visual offset;
- jump meter: bottom-center at its current visual offset;
- existing corner-attached surfaces retain their current margins.

The toast receives a bounded, fixed layout lane sized for the current notification distribution;
its message remains centered and may wrap inside that lane. It is movable but not resizable. The
jump meter uses its existing fixed visual footprint and is likewise movable but not resizable.
Narrow-viewport inner padding must preserve the toast's current readable side margins even if the
resolved layout lane consumes the available width.

### Runtime versus layout presentation

Replace the inverted boolean with a mode whose meanings are explicit:

```ts
type ClientHudMode = "runtime" | "layout";
```

- Runtime mode preserves current visibility and interaction behavior.
- Layout mode mounts every configurable, capability-available surface and exposes its movement
  affordance; existing resizable surfaces retain resize affordances.
- A missing runtime toast is represented by one constant status-style preview message owned by the
  UI layer, not `ClientToastCenter`.
- An inactive jump meter is represented at a fixed partial extent without touching the input
  controller or active jump sequence.
- A closed diagnostics window is shown in layout mode only when `debugEnabled` is true. Its close
  action is suppressed while layout mode requires it visible.
- Preview-only content must not use live-region alert/status semantics and preview controls must
  not dispatch gameplay actions. A real toast shown while editing retains its real semantics;
  only the fabricated placeholder is inert.
- The UI-lock button remains fixed above surfaces and toggles the mode. Returning to runtime mode
  immediately restores real visibility without discarding edited placements.

### Visual wrappers

- Evolve `ClientHudPanel` only as needed to host fixed-size movable surfaces cleanly.
- Strip viewport positioning from `ClientToastOverlay` and `ClientJumpPowerBar`; they become
  content components filling geometry supplied by the shell.
- Do not merge `ClientHudPanel`, `ClientHudWindow`, and `MapPanel` into a god component. They
  share placement types and resolver functions while retaining deserved chrome and gestures.

## Phase 1: Generalize the Placement Kernel

### Deliverables

- Update `client-hud-layout.ts` with `ClientHudAxisAlignment`, `ClientHudAxisAnchor`, generalized
  axis resolution, and three-way anchor capture.
- Replace physical-edge fields in `ClientHudPlacement` with horizontal and vertical axis anchors.
- Migrate the existing placement consumers in `ClientWorldView.svelte`, `ClientHudPanel.svelte`,
  and `ClientHudWindow.svelte` to the new vocabulary without yet changing surface ownership or
  visibility.
- Update `client-hud-layout.test.ts` before migrating Svelte consumers.

### Task checklist

- [x] Express start, center, and end resolution through one axis helper.
- [x] Define signed center offsets and clamp them while retaining preferred dimensions for later
      restoration.
- [x] Extend rectangle capture to select among three reference points per axis.
- [x] Preserve square resolution for the radar against the tighter resolved axis.
- [x] Keep all resize math in concrete rectangles; re-anchor only after the gesture resolves the
      new rectangle.
- [x] Translate existing defaults, radar placement, and diagnostic placement into the new axis
      vocabulary while preserving their current geometry.
- [x] Migrate ordinary HUD and titled-window drag/resize consumers in the same phase as the type
      change.
- [x] Replace old edge-vocabulary tests rather than retaining compatibility assertions.

### Acceptance criteria

- All nine alignment combinations resolve inside ordinary and constrained viewports.
- Top-center, right-center, bottom-center, left-center, and screen-center placements retain their
  alignment through shrink and regrowth.
- Preferred dimensions restore after temporary viewport constraints.
- Drag capture selects start, center, or end without changing the captured rectangle.
- Existing border and bottom-right resize behavior remains bounded and minimum-aware.
- `npm run test:ts -- client-hud-layout.test.ts` passes from `apps/holtburger-3d`.
- `npm run check` passes from `apps/holtburger-3d`; no intermediate compatibility type remains.

### Decisions and course corrections

- Dry run: a discriminated nine-way anchor would duplicate axis math and make future resizing more
  complex. Two independent three-way axes cover the requirement with less state and lower
  cyclomatic complexity.
- Dry run: no compatibility adapter is useful. There are only three production consumers and one
  test file, so Phase 1 migrates them atomically and ends in a compiling clean cutover.
- Implemented 2026-09-01: `resolveAxis` now owns all three alignments, and `positionAxis` is the
  single conversion from a resolved axis to concrete CSS coordinates. Center offsets are signed;
  constrained resolution clamps their reachable range without mutating canonical placement.
- Implemented 2026-09-01: anchor capture compares the absolute start, signed-center, and end
  distances independently on both axes. Deterministic `start`, `center`, `end` candidate order
  resolves exact ties without a second hysteresis policy.
- Evidence: `npm run test:ts -- client-hud-layout.test.ts` passed 18/18 tests; `npm run check`
  passed Svelte diagnostics and every TypeScript project with zero warnings/errors.

## Phase 2: Make the Client Shell the Complete Layout Owner

### Deliverables

- Refactor `ClientWorldView.svelte` to own one complete `ClientHudLayout` and one `ClientHudMode`.
- Expand `ClientHudLayout` and `createDefaultClientHudLayout` to inventory every client HUD surface.
- Fold `mapPlacement` and `debugPlacement` into the named layout fields while leaving map view and
  diagnostic visibility state separate.
- Make the FPS placement genuinely top-center.

### Task checklist

- [x] Preserve the existing `ResizeObserver` as the sole viewport publication path.
- [x] Evaluate a typed field-update helper; retain explicit whole-layout spread updates because a
      helper or registry would obscure eight statically typed mount consumers without removing
      policy.
- [x] Adapt map changes back into `layout.map` while preserving preferred square size and separate
      `mapViewDiameters`.
- [x] Migrate diagnostics drag/resize through `layout.diagnostics`.
- [x] Add named defaults for map, diagnostics, toast, and jump; rename `fps` to `frameRate` during
      the clean ownership cutover.
- [x] Rename lock-state branches to runtime/layout mode branches and keep the button's accessible
      labels truthful.
- [x] Prove every currently mounted `ClientHudLayout` field has one named mount consumer; toast and
      jump consumers land atomically with their Phase 3 migration.

### Acceptance criteria

- No independent `mapPlacement`, `debugPlacement`, or pseudo-centered FPS coordinate survives.
- Every currently always-visible surface behaves as before in runtime mode.
- Resizing the world container re-resolves every placement from the same viewport snapshot.
- Type checking reports no old `edge: "left" | "right" | "top" | "bottom"` placement vocabulary.

### Decisions and course corrections

- Dry run: the shared `MapPanelState` should not absorb HUD anchors. Explorer legitimately owns raw
  panel geometry today, and map zoom is not layout geometry. The client adapter remains the clean
  boundary.
- Dry run: a generic runtime surface registry would erase prop types and conditional capabilities
  for little benefit at eight surfaces. One composite layout plus explicit Svelte mounts is the
  smaller, more maintainable system.
- Implemented 2026-09-01: `ClientHudLayout` now owns character, chat, diagnostics, frame rate, jump
  power, map, shortcuts, and toast placements. The radar view diameters and diagnostic open state
  remain separate content/visibility facts as designed.
- Implemented 2026-09-01: `uiLocked`, `mapPlacement`, `debugPlacement`, and the launch-time FPS
  centering coordinate were deleted. `ClientHudMode` names runtime/layout presentation directly,
  and frame rate now authors a real zero-offset center anchor.
- Course correction 2026-09-01: the original Phase 2 checklist required all eight layout fields to
  have mount consumers before Phase 3 migrated toast and jump. The ownership shape did not change;
  the consumer proof was completed with Phase 3 rather than creating temporary wrapper code.
- Evidence: the 18 layout tests and complete `npm run check` passed after the ownership cutover.

## Phase 3: Migrate Transient Surfaces and Add Layout Preview

### Deliverables

- Convert `ClientToastOverlay.svelte` and `ClientJumpPowerBar.svelte` into shell-positioned content.
- Mount both through the client HUD surface boundary using `layout.toast` and `layout.jumpPower`.
- Implement inert preview presentation for absent toast, inactive jump, and closed diagnostics.
- Preserve all runtime gameplay and accessibility semantics while locked.

### Task checklist

- [x] Remove fixed `left`, `bottom`, and translate positioning from toast and jump CSS.
- [x] Retain `.client-toast` for the live UI probe and existing semantic styling.
- [x] Give toast and jump explicit fixed-size/movable/non-resizable surface policies.
- [x] Render the real toast in either mode when present; otherwise render the inert placeholder
      only in layout mode.
- [x] Render the real jump extent while charging; otherwise use the preview extent only in layout
      mode.
- [x] Disable the precise-jump action for preview-only jump content.
- [x] Show diagnostics during layout mode only when the launch capability exists, without changing
      `debugOpen`.
- [x] Ensure leaving layout mode removes every preview-only node immediately.

### Acceptance criteria

- In runtime mode, toast and jump are absent under exactly the same conditions as before.
- In layout mode, toast, jump, and capability-available diagnostics are visible and movable even
  when their runtime state is absent/closed.
- Moving a centered transient surface updates its canonical anchor and it survives subsequent
  width and height changes.
- Preview content publishes no toast, begins no jump, enters no precise-jump mode, opens no
  diagnostics runtime state, and emits no false live-region announcement.
- Real toast replacement/expiry tests and jump behavior tests remain unchanged and pass.

### Decisions and course corrections

- Dry run: preview state belongs in `ClientWorldView`, not `ClientApp`, `ClientToastCenter`, or the
  character input controller. Those owners describe gameplay/runtime facts and must remain blind
  to layout editing.
- Dry run: the diagnostics surface is capability-gated. Layout mode exposes configurable UI, not
  developer functionality deliberately absent from a non-debug launch.
- Dry run: toast content has variable text but the observed client notifications are short status
  and rejection messages. A bounded wrapping lane is deserved; content measurement and auto-size
  feedback are not.
- Implemented 2026-09-01: toast and jump are content-only components mounted through
  `ClientHudPanel`. The toast lane is 420×64 preferred CSS pixels with preserved narrow-screen
  inner padding; jump power is the current composed 38×132 CSS-pixel footprint. Neither is
  resizable.
- Implemented 2026-09-01: preview facts are nullable props supplied by `ClientWorldView`. A preview
  toast has no `alert`/`status` role, and the jump action is disabled throughout layout mode while
  the real charge still renders if one exists.
- Implemented 2026-09-01: diagnostics visibility is `debugEnabled && (debugOpen || layout mode)`;
  the close control is disabled during layout mode without modifying `debugOpen`.
- Evidence: `npm run check` passed with zero Svelte/TypeScript diagnostics; 27/27 focused tests
  passed across layout, toast lifetime, and precise-jump session behavior.

## Phase 4: Browser Evidence and Interaction Hardening

### Deliverables

- Extend `ClientHudHarness.svelte` with deterministic runtime/layout-mode entry and DOM-readable
  fixture evidence.
- Extend the canonical browser harness only as much as needed to launch the existing client-HUD
  fixture, resize its viewport, perform drag gestures, and capture state/screenshots without an
  interactive client.
- Add focused component/policy tests only where behavior cannot be proven by the geometry unit
  tests and harness.

### Task checklist

- [x] Exercise a normal runtime fixture with no toast and no active jump.
- [x] Enter layout mode and assert all eight capability-available surfaces are present.
- [x] Verify preview toast and jump are inert.
- [x] Drag at least one normally hidden surface into a center alignment and inspect its resolved
      rectangle before and after narrow and short viewport resizes.
- [x] Verify existing corner anchors and the square radar remain reachable after the same resize.
- [x] Return to runtime mode and assert preview-only surfaces disappear while edited always-visible
      surfaces keep their placements.
- [x] Capture wide and constrained screenshots to judge handles, toast wrapping, overlap, and lock
      control reachability.
- [x] Check browser console errors during the full interaction sequence.

### Acceptance criteria

- The non-interactive browser run proves layout-mode visibility, drag capture, resize survival,
  and return-to-runtime behavior.
- Wide and constrained screenshots show no clipped editor handles or unreachable lock control.
- Toast text remains readable at the narrow fixture width.
- Existing client HUD, live-client probe selectors, and map rendering behavior remain intact.

### Decisions and course corrections

- Dry run: the existing `ClientHudHarness` already carries all required content and diagnostics
  fixtures, so no bespoke live client or TUI diagnostics are justified.
- Dry run: geometry belongs in unit tests; browser automation should prove integration and
  interaction rather than duplicate every numeric anchor case.
- Implemented 2026-09-01: `ClientHudHarness` exposes only fixture-local capture, mode-toggle,
  drag, and transient-state controls. Production components contain no test hooks. The canonical
  `npm run harness:browser -- --client-hud` path owns CDP resizing and assertions.
- Implemented 2026-09-01: layout move and HUD-window resize handles moved just inside their owning
  rectangles. The old outward offsets made controls clip even when placement geometry was valid;
  the new positions affect layout chrome only.
- Evidence: the harness proved five runtime surfaces, all eight layout surfaces, inert preview
  semantics, disabled layout actions, zero precise-jump dispatches, and live runtime toast/jump
  semantics after returning to runtime mode.
- Evidence: moving jump power 80 CSS pixels from screen center retained that center-relative offset
  at 520×720, 520×360, and restored 1280×720 viewports. Every surface and move handle remained
  inside each measured content box; reopening layout mode restored the edited placement.
- Visual evidence: 1280-wide, 520-wide, and 520×360 captures showed readable toast padding and
  reachable editor chrome. At 520×360 diagnostics overlaps other surfaces heavily; this is an
  expected consequence of explicit user-owned overlap policy, not hidden clipping or auto-layout
  debt.
- Environment note: headless Chrome's initial 1280×720 window exposed a 1280×633 content box,
  while CDP's explicit restoration exposed 1280×720. The observed `ResizeObserver` content box was
  authoritative in both cases and all assertions passed. Chrome emitted process-level GCM/zygote
  shutdown noise on stderr; the page reported no console errors or exceptions.

## Phase 5: Cleanup and Final Verification

### Task checklist

- [x] Sweep `apps/holtburger-3d/src/client` for obsolete fixed-position toast/jump CSS, old
      left/right/top/bottom anchor vocabulary, `uiLocked`, and split placement state.
- [x] Remove dead helpers, compatibility types, and tests that preserve the replaced model.
- [x] Confirm every layout field and preview constant has a named consumer.
- [x] Run formatting, Svelte/TypeScript checks, ESLint/Knip, and the complete frontend test suite.
- [x] Re-run the client HUD browser evidence after formatting and cleanup.
- [x] Record implementation decisions, any visual concessions, and commands/results in this plan.

### Acceptance criteria

- From `apps/holtburger-3d`: `npm run format:check`, `npm run check`, `npm run lint`, and
  `npm run test:ts` pass.
- The final browser harness sequence passes with no browser errors.
- No host, protocol, shared-game-runtime, Explorer, or retail behavior marker changes appear in
  the diff.
- The final diff contains one canonical layout vocabulary and no vestigial fixed positioning for
  configurable client HUD surfaces.

### Phase 5 results (2026-09-01)

- Removed three unused public exports found by Knip: the axis types remain private implementation
  detail exposed structurally through `ClientHudPlacement`, and the map default size remains local
  to the default-layout factory.
- Static jump preview now writes its representative extent once. Only a real active charge retains
  the animation-frame sampling loop, preserving the cold-UI boundary during layout editing.
- Edge-center capture coverage now names top-center, right-center, bottom-center, left-center, and
  screen-center rectangles directly rather than inferring capture behavior from resolution tests.
- The post-cleanup `--client-hud --brief` run exposed a generic report-path assumption about
  Explorer authored-dynamic state. Client-HUD output now routes before generic brief/nameplate
  reports; the corrected command passed its full scenario and page-console assertions.
- Sweeps found no surviving `uiLocked`, split map/diagnostic placement state, `hudLayout.fps`, old
  canonical `edge` placement fields, or fixed/translated toast and jump positioning.
- Verification from `apps/holtburger-3d`:
  - `npm run format:check` passed.
  - `npm run check` passed every Svelte and TypeScript project with zero diagnostics.
  - `npm run lint` passed ESLint, Knip, and host clippy with warnings denied.
  - `npm run test:ts` passed 1,851/1,851 tests across 245/245 files.
  - `npm run harness:browser -- --client-hud --viewport-width 1280 --viewport-height 720 --brief`
    passed after cleanup with only Vite debug messages in the captured page console.
  - `git diff --check` passed.
- No host, protocol, shared-runtime, Explorer, ACE, ACViewer, or retail-decompile source changed.
- Follow-up cleanup 2026-09-01: renamed the titled diagnostics wrapper as `ClientHudWindow`, making
  its role as HUD-system window chrome explicit. The rename includes component, CSS, harness, test,
  comment, and plan vocabulary; no compatibility alias remains.
- Follow-up cleanup 2026-09-01: collapsed three identical window-level pointer trackers from
  `ClientHudPanel`, `ClientHudWindow`, and `MapPanel` into the injected, stateless
  `trackPointerGesture` helper. Placement math and each surface's distinct gesture policy remain in
  their existing owners; this does not introduce a universal panel component.
- Follow-up evidence: `npm run format:check`, `npm run check`, and `npm run lint` passed; the focused
  layout suite passed 18/18 tests. The client-HUD browser harness passed its runtime/layout,
  diagnostics-control, drag, constrained-resize, and restoration sequence with no page-console
  errors.

## Risks and Mitigations

| Risk                                                     | Mitigation                                                                                                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Center offsets become ambiguous during shrink/regrowth   | Define the signed center invariant once, test constrained viewports, and preserve canonical placement rather than writing clamped rectangles back during passive resize.                                               |
| Three-way capture changes alignment while dragging       | Reconstruct the exact rectangle for every candidate; switching canonical alignment must be visually lossless at capture time. Use deterministic ties.                                                                  |
| Toast text exceeds a fixed surface footprint             | Preserve wrapping and narrow-screen inner margins, use a bounded lane sized against current messages, and inspect the longest fixture plus a constrained screenshot. Do not add measurement feedback without evidence. |
| Layout preview accidentally drives gameplay              | Keep preview facts in the shell, make preview-only controls inert, and assert that gameplay callbacks/owners receive no calls.                                                                                         |
| Conditional diagnostics leaks into non-debug builds      | Continue to gate the surface on immutable `debugEnabled`; layout mode only overrides open/closed state.                                                                                                                |
| A universal wrapper becomes a god component              | Share only placement math and common move affordances. Keep round map and titled-window chrome separate.                                                                                                               |
| Responsive clamping overwrites user intent               | Resolve canonically on every viewport publication; only drag/resize gestures update placement state.                                                                                                                   |
| Editor handles become unreachable on very small windows  | Include handles in constrained visual evidence and keep the lock button fixed above the HUD layer.                                                                                                                     |
| Browser harness work balloons into a second UI framework | Add only deterministic entry, interaction, resize, and evidence hooks around the existing `ClientHudHarness`.                                                                                                          |

## Definition of Done

- [x] One `ClientHudLayout` owns every configurable client in-world UI placement.
- [x] Both axes support start, center, and end anchors with tested signed center offsets.
- [x] All four edge centers and screen center can be acquired through ordinary dragging.
- [x] FPS, toast, and jump defaults use real center anchors and remain centered on resize.
- [x] Toast and jump contain no independent viewport-positioning CSS.
- [x] Layout mode exposes every capability-available surface with safe representative content.
- [x] Runtime mode preserves existing conditional visibility and gameplay behavior.
- [x] Layout preview mutates no gameplay/runtime owner and produces no false accessibility event.
- [x] Every surface remains reachable through constrained resize and restores preferred geometry
      when space returns.
- [x] Focused tests, full frontend tests, checks, lint, formatting, and browser evidence pass.
- [x] Old anchor vocabulary and split placement mechanisms are removed in the same change.

## Open Questions

No product or architecture questions remain. Harness review settled the toast lane at 420×64
preferred CSS pixels with responsive inner side padding, the jump footprint at its composed 38×132
CSS pixels, and the inert copy at “Notification preview.” The 520-wide and 520×360 evidence
confirmed those choices without introducing auto-layout or content-measurement machinery.
