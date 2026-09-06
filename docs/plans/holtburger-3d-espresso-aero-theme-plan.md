# Espresso Aero: UI Theme Implementation Plan and Style Guide

Status: complete and accepted. Implementation, both mode cutovers, cleanup, and
durable documentation are complete. Final verification includes settled full-modal
performance as well as the normal tools window. The user approved the final
appearance and retaining the current glass default.

## Goal

Make the 3D app's UI consistently themeable through one declarative configuration,
with Espresso Aero as the default: warm coffee-shop colors, polished walnut
details, aged metal trim, and smoked, frosted glass.

## Context and boundaries

We already have shared CSS variables and style classes, but not a complete theme
contract. Component-local colors, gradients, borders, and shadows frequently
bypass those shared definitions. Moving colors alone will not unify the UI;
the common material and interaction recipes must be consolidated too.

In scope:

- A typed, plain-data Espresso Aero definition and a bounded theme application
  path using CSS custom properties.
- Shared surface, frame, control, typography, and interaction-state styling.
- Client lifecycle screens and in-world HUD first, then Explorer and shared UI.
- Reduced-transparency presentation and reduced-motion behavior.
- A browser style specimen, visual evidence, and real-GPU performance checks.
- A complete-configuration injection seam for future user settings.

Out of scope:

- A theme editor, installation settings persistence, theme import/export,
  downloaded themes, arbitrary user CSS, or a theme marketplace.
- New game panels, changing HUD layout defaults, or changing input policy.
- Restyling world rendering, map terrain/blip semantics, selection outlines in
  the world, or portal effects. Those retain their existing presentation tuning.
- Replacing Svelte, adding a component framework, or reproducing Vista/retail
  client assets. The references describe a direction, not an asset source.

Everything stays within `apps/holtburger-3d`. No Rust crate or host contract
changes are warranted. A theme is app presentation policy, not game semantics.

## Ground truth and implementation references

Paths below are relative to `apps/holtburger-3d/` unless stated otherwise.

| Existing source | What it establishes |
| --- | --- |
| `src/app/base.css` | Shared structural browser defaults after the clean cutover. |
| `src/app/ui-theme-recipes.css` | Shared materials, control states, fallback presentation, and top-layer modal treatment. |
| `src/app/themes/espresso-aero.ts` | Complete default palette and material tuning; frame grain is procedural CSS. |
| `src/client/main.ts`, `src/explorer/main.ts`, `src/harness/browser/main.ts` | All import shared styling; Explorer and the harness also import Explorer CSS. Changes have cross-mode impact. |
| `src/client/ClientSelectedEntityHud.svelte` | Existing warm translucent surface, rounded rim, inset controls, and glossy meter; useful starting reference, not the canonical implementation. |
| `src/client/ClientChat.svelte`, `src/client/client-chat-policy.ts` | Local styling and existing semantic message roles. Preserve message classification while changing its palette. |
| `src/client/ClientHudPanel.svelte`, `src/client/ClientHudWindow.svelte` | Existing placement, resize, and hit-testing ownership. Styling must not change these behaviors. |
| `src/client/client-ui-defaults.ts` | Precedent for declarative app-local configuration; owns arrangement, not theme materials. |
| `src/explorer/explorer.css`, `src/explorer/ExplorerTools.svelte`, `src/explorer/ExplorerTexturePageModal.svelte` | Explorer chrome, dense tabs/forms, and modal surfaces that must share the same styling vocabulary. |
| `src/app/Minimap.svelte`, `src/lib/game/map/map-appearance.ts` | Boundary between themeable UI chrome and independently tuned map visualization. |
| `src/lib/input/viewport-input-gate.ts` | Existing input coordination; decorative layers must not steal gestures or require new input routing. |
| `src/harness/browser/ClientHudHarness.svelte`, `scripts/browser-harness.mjs` | Real-browser HUD interaction coverage and the canonical place to add a style specimen. |
| `AGENTS.md`, repository `docs/code-quality-audit-patterns.md` | Runtime verification, reactive lifetime, ownership, and clean-cutover requirements. |

Inspect these sources again during implementation. Existing behavior and the
actual consumer inventory take precedence over assumptions in this plan.

## North stars

1. **A crafted instrument, not a desktop skin.** Wood and aged metal place the
   interface in Dereth; glass supplies depth and the modern character.
2. **Reading wins over translucency.** A bright landscape must not wash out chat
   or obscure a control's state.
3. **Material hierarchy creates consistency.** Surfaces may have different
   emphasis without inventing different styling systems.
4. **One role, one owner.** Components consume shared recipes; the theme supplies
   their values. Local layout remains local.
5. **Configuration should be unsurprising.** Editing a named theme value affects
   all intended consumers without hunting down component exceptions.
6. **The game remains the focal point.** Decorative detail belongs at the edges,
   not over every pixel of the viewport.
7. **Customization must not own runtime lifetime.** Applying appearance must not
   recreate the renderer, host session, controllers, or HUD placement state.

## Espresso Aero style guide

### Identity and naming

- Display name: **Espresso Aero**.
- Stable identifier, wherever one is needed: `espresso-aero`.
- Concept: flat charcoal glass, ivory lettering, muted brass controls, and a
  narrow walnut accent. Warmth is an accent, not an all-brown surface palette.
- Theme-specific names belong in the theme definition and assets. Shared
  component classes and token roles must not contain coffee, walnut, or Aero.

### Palette

These are starting swatches for the visual specimen, not immutable test values.
Final opacity and composited contrast must be judged over actual scenes.

| Role | Starting direction | Use |
| --- | --- | --- |
| Deep surface | Warm charcoal, `#242522` | Glass tint and opaque fallback. |
| Reading well | Ink charcoal, `#191B19` | Inputs and dense window data. |
| Control | Muted brass, `#645631` | Flat window-button fill. |
| Frame detail | Walnut, `#60432D` | A narrow header accent only. |
| Primary text | Warm ivory, `#F4F0E5` | Labels, chat, and primary values. |
| Secondary text | Pale linen, `#E5DDCB` | Supporting information with readable contrast. |
| Accent | Light brass, `#E6CD8B` | HUD glyphs, active tabs, and selected controls. |
| Edge | Soft brass, `#C7BA91` | Essential window/control boundaries. |

Semantic status colors are a separate family. Preserve recognizable health,
stamina, and mana identities; distinguish errors, warnings, success, and chat
roles. Tune them to coexist with the warm palette, not to become uniformly brown.
Disabled text is still information and must remain legible.

### Materials and where they belong

**Smoked glass**

- Framed glass is for actual windows, such as diagnostics and inspectors.
  HUDs are information over the game, not small windows.
- Use a neutral charcoal translucent body with a faint warm tint. No broad
  reflection or inset bevel; only a restrained window-separation shadow.
- Begin specimen experiments around 8–12 CSS pixels of blur. This is a visual
  starting point, not a performance promise or a required value.
- Apply blur once to the owning surface. Children use ordinary translucent or
  opaque fills rather than stacking additional backdrop filters.
- No blur animation, animated reflective sweeps, or continuously moving grain.

**Reading wells**

- Use for window inputs and dense diagnostic values, not whole chat areas.
- Darker and more opaque than the surrounding glass, without inset shading.
- No wood grain underneath text. Avoid strong reflections across reading lines.
- Chat can remain visually lighter near unused space, but visible messages need
  a reliable backing rather than depending on the current world background.

**Flat brass controls**

- Buttons and active tabs have flat muted brass fills, not bevels or glossy gradients.
- Hover brightens the brass; pressed controls darken. Selection uses a thin underline.
- Primary actions earn stronger brass emphasis. Ordinary buttons are not all
  bright accent blocks.
- HUD glyph controls use a separate borderless recipe with a small translucent
  backing. Warm color, restrained hover/selection accents, and clear focus retain
  the theme without button bevels or enclosing dock surfaces.

**Borderless HUD overlays**

- Follow ClientCharacterHud.svelte: a small identity strip, unlabeled bars with
  descending heights, and compact condition glyphs. Keep vital semantics in
  accessible labels/tooltips; do not add permanent labels or allegiance copy.
- Follow ClientChat.svelte: fade unused message space into the scene, keep
  readable backing near messages, and put quiet filters above the input at the
  bottom. No title bar, outer border, opaque reading well, or panel shadow.
- Follow ClientShortcutDock.svelte's unenclosed row. Remove the specimen's
  enclosing dock and decorative number labels; names live in tooltips.
- FPS and notifications are short readouts, not cards. Target information gets
  a name, useful glyph actions, and a thin health bar without an outer frame.
- Keep the existing layout rectangles as interaction/layout allocations; they
  do not need to be filled by a painted surface.
- HUD backings feather into the game rather than ending as hard rectangles.
  Readouts use horizontal and vertical linear fades outside their content box;
  glyph controls use radial backings. Keep the backing strongest beneath text.
  These gradients vary transparency, not illumination: they do not reintroduce
  button bevels or glossy material shading.
- Preserve glass transparency and use charcoal backing with brass glyph accents.
  Maintain readable local text backing rather than
  compensating by darkening an entire HUD rectangle.

**Walnut frame**

- Restrict grain to a narrow window-header detail, initially 3px tall. Do not
  fill the title bar with wood. Most UI surfaces remain neutral charcoal.
- Grain is dark, fine, and low contrast. Avoid obvious repeating knots, stretched
  grain, orange planks, carved fantasy ornament, and heavy picture-frame borders.
- Match grain direction to the surface. Do not build a nine-slice system unless
  the approved specimen demonstrates that simple layered CSS cannot suffice.
- One shared frame treatment owns the texture and finish. Components do not
  choose independent wood images.
- The recipe must also work with a texture-free frame so another theme can
  replace wood with plain metal or a flat surface.

**Aged metal**

- Use thin copper/brass separators, rims, and small accent details.
- Prefer a shaded edge to bright yellow outlines around every element.
- Do not add ornamental hardware with no useful visual hierarchy.

### Shape, spacing, and typography

- Start with a small shared radius scale: roughly 3px for surfaces and 2px
  for controls. Rounded corners should not create desktop-card proportions.
- Keep borders thin and highlights finer than the underlying frame.
- Compact is the default, not a separate HUD variant. Start with 2–6px gaps,
  4–8px surface padding, and 24px controls. Keep readable 13px body text;
  remove ceremony and padding before reducing text size.
- Use the existing client layout defaults as specimen footprints. Identity and
  vitals are a compact strip, target information is a small HUD, and chat reserves
  its area for messages with a single tight input row. Do not grow layout defaults
  to accommodate the material treatment.
- Wood belongs on narrow title bars of actual windows and fine edge details.
  Readouts do not acquire title bars, subtitles, or nested cards for decoration.
- Clean sans-serif text for controls, chat, and dense data. Restrained serif
  headings provide character without turning every label into parchment.
- Use tabular numerals for changing numeric readouts. Avoid heavy black text
  shadows, excessive tracking, and small italic informational text.
- Existing icons should be visually harmonized through size, color, and button
  treatment; replacing the icon system is not a prerequisite.

### Interaction and accessibility

Every shared control recipe covers normal, hover, pressed, selected, disabled,
and keyboard-focus states. Selection and keyboard focus remain distinguishable.
Use shape, borders, labels, or position as well as color to communicate state.

Project acceptance targets: at least 4.5:1 contrast for normal informational text
and 3:1 for focus indicators and essential control boundaries against their
adjacent colors in the specimen. Check composited results, not just palette
swatches. Muted does not mean unreadable.

Reduced transparency uses deliberately more opaque surfaces and disables blur;
it must still look finished, with the same material hierarchy. Browser feature
fallbacks must also produce usable opaque surfaces. Keep this as a named
presentation preference, not a second theme fork.

Respect reduced motion. Otherwise use short, subtle color/opacity transitions;
do not animate layout, blur radius, or large decorative shadows. Decoration
must not change hit testing, obscure focus rings, or block resize handles.

## Target architecture

Implemented files under `src/app/`:

- `ui-theme-contract.ts`: independent typed contract for the roles actually
  consumed by shared styling. Group text, surfaces/frame, accents/status,
  controls, radii, typography, and effects; do not add unused hypothetical tokens.
- `themes/espresso-aero.ts`: the complete declarative default definition.
  Existing fonts are sufficient initially. Asset references resolve through the
  app build; do not introduce externally fetched assets.
- `ui-theme.ts`: explicit theme-to-CSS-variable projection and application to
  an injected root element. Keep DOM application separate from pure projection.
- `base.css`: structural browser defaults, without an independent palette.
- `ui-theme-recipes.css`: shared material and control recipes. Split by coherent
  recipe families only if its final size warrants it.

Use role-based custom properties such as `--ui-color-text`,
`--ui-color-surface`, and `--ui-color-focus`. Keep the contract finite; this is
not a CSS AST, arbitrary style object, or per-component override registry.
Material layers and state selectors belong to recipes; configurable colors,
strengths, sizes, and asset choices belong to theme data.

Apply the default before mounting visible UI in each entry point. Define one
owner for theme application and its lifetime; the browser specimen may mount
isolated theme roots to compare configurations. Avoid depending on CSS reads
inside frame loops. An ordinary cold theme update can update variables in place.

Theme data and layout defaults remain separate. Do not add theme fields for
panel positions or per-window dimensions. Do not move viewport input behavior
into a theme provider.

The first implementation consumes a complete theme plus an explicit
reduced-transparency preference. Saved overrides and precedence rules remain
deferred. A second, test-owned configuration proves the seam without shipping
an unnecessary second product theme.

## Phased implementation

### Phase 1: Inventory and bounded theme foundation

Deliverables: consumer inventory recorded here during execution; theme contract,
Espresso Aero data, projection/application code, and focused unit tests.

- [x] Inventory shared and component-local appearance declarations in client,
  shared app UI, and Explorer. Classify them as shared recipe, legitimate local
  geometry, semantic visualization, or removable duplicate.
- [x] Inspect the existing texture and establish provenance for any retained or
  new asset. Prefer CSS for glass/bevels; add a small licensed/provenance-recorded
  grain asset only if it materially improves the approved frame treatment.
- [x] Define the smallest contract with named production consumers.
- [x] Implement deterministic variable projection and explicit reduced-
  transparency behavior. Validate authored numeric invariants where violations
  would otherwise yield invalid or misleading CSS; report invalid configuration.
- [x] Add fixture-based tests for projection, preference handling, and invalid
  inputs. Do not assert that the default palette remains a particular palette.

Acceptance: unit tests and type checking pass; an alternate complete fixture can
produce a different theme without modifying component code. Existing production
styling remains intact until the shared recipe cutover.

### Phase 2: Style specimen and shared recipes

Deliverables: harness-owned style specimen and initial shared material/control
recipes using the new theme contract.

- [x] Add a focused specimen route/mode to the existing browser harness and a
  discoverable npm-driven invocation; document the actual invocation here.
- [x] Show a framed window, chat/input, tabs, buttons in all interaction states,
  vitals, notification, tooltip, and compact HUD controls.
- [x] Compare dark and bright backgrounds, textured/moving game backgrounds,
  overlapping windows, and reduced transparency.
- [x] Build each material/state recipe once; wrappers are justified only by
  shared markup or behavior, not merely to attach a CSS class.
- [x] Capture screenshots and measure composited contrast against the style
  guide targets. Verify keyboard focus and opaque fallback presentation.
- [x] Probe backdrop-filter stacking, clipping, and pointer behavior before
  migrating components.

Acceptance: the specimen demonstrates all guide materials and states using
shared recipes, meets the contrast targets, and has no browser errors.

### Phase 3: Visual and architecture review checkpoint

- [x] Review screenshots with the user for warmth, wood prominence, gloss,
  typography, and density before broad migration.
- [x] Confirm that a texture-free test theme can use the same recipes.
- [x] Review token count and every local styling exception. Remove fields with
  no real consumer and avoid separate tokens for indistinguishable roles.
- [x] Reassess remaining work, record decisions below, and dry-run the client
  and Explorer migration against the actual consumer inventory.

Acceptance: visual direction is explicitly approved; any changes to scope,
material recipes, or the migration sequence are recorded before proceeding.

### Phase 4: Client cutover

Deliverables: themed client startup/character selection and complete in-world
HUD, using production theme application and shared recipes.

- [x] Apply Espresso Aero before client mount.
- [x] Migrate lifecycle panels, character selection, HUD window chrome, vitals,
  chat/filter controls, shortcuts, selected target, jump power, notifications,
  FPS, and layout-editing affordances.
- [x] Migrate shared minimap DOM chrome without recoloring map data or changing
  map navigation. Inspect any retained SVG paint for legitimate semantic use.
- [x] Preserve chat semantic roles; map those roles to theme values rather than
  classifying messages again inside styling code.
- [x] Delete replaced local colors, material gradients, and shadow recipes in
  each touched component during its cutover.
- [x] Verify existing HUD geometry, dragging, resizing, overlap hit testing,
  chat focus, selection, precise jump, and lifecycle transitions.

Acceptance: every inventoried client chrome surface uses the shared vocabulary;
the existing client HUD browser harness passes; screenshots cover startup,
runtime, and layout-editing states. Theme application does not reset layout or
recreate imperative runtime owners.

### Phase 5: Explorer cutover and performance review

Deliverables: consistent Explorer surfaces and cross-mode runtime evidence.

- [x] Apply the theme before Explorer mount. Migrate tools, tabs, forms,
  inspectors, modal surfaces, tooltips, and errors to the same recipes.
- [x] Keep Explorer density and layout policy local; do not force client HUD
  dimensions onto developer tools.
- [x] Sweep import order and global selectors, including the browser harness's
  combined imports. Explorer CSS must not override shared materials incidentally.
- [x] Compare full and reduced transparency on the real GPU with identical
  scene, viewport, device scale, render scale, and visible-panel workload.
- [x] Record at least five samples per configuration, including median and
  spread. Inspect browser compositor/frame evidence as well as renderer timings:
  CSS backdrop work is not necessarily attributed by WebGL timers.
- [x] Check dense scrolling, overlapping panels, resize gestures, and moving
  world backgrounds. Remove nested blur or reduce filtered area if necessary.

Acceptance: Explorer interactions and browser console checks pass; both modes
look coherent. Record measured cost and an agreed acceptable performance tradeoff;
do not invent a universal frame budget before measuring.

### Phase 6: Cleanup and durable documentation

- [x] Remove superseded palette variables, compatibility aliases, obsolete
  material classes, unused image assets, and duplicated global/local styling.
  If `ac-*` mechanisms are renamed, sweep their consumers and surviving docs
  in the same cutover; do not leave parallel old/new theme vocabularies.
- [x] Keep reset/layout rules separate from material styling. Account for every
  remaining literal appearance value in migrated UI.
- [x] Remove brittle default-value tests. Keep semantic behavior and actual
  theme-projection tests with test-owned inputs.
- [x] Publish the implemented style guide in durable app documentation and link
  it from the README, including the theme edit point, recipe usage, accessibility
  preferences, asset provenance, and deferred settings support.
- [x] Run final checks and repeat representative browser screenshots after all
  formatting has finished.

Acceptance: no compatibility theme or duplicate styling path remains; documentation
matches implementation; all verification below passes.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Transparent text backing fails over bright scenery | Use more opaque reading wells; measure composited contrast over representative backgrounds. |
| Blur costs more than renderer profiling suggests | Use real-GPU and browser compositor evidence; limit filtered area and avoid nested filters. |
| Blur or decorative layers change stacking/hit testing | Verify overlap, clipping, focus rings, pointer routing, and resize handles in the real browser. |
| A token file merely hides inconsistent component recipes | Migrate recipes and interaction states, not just color literals. |
| Theme work grows into a UI framework or world-rendering rewrite | Keep a bounded role contract and explicit semantic-visualization exclusions. |
| Wood creates visual noise or obvious tiling | Restrict grain to frames; review at actual HUD scale; retain a texture-free treatment. |
| Stronger padding and borders overflow current HUD geometry | Test current defaults and compact viewports; adjust recipe density before proposing layout changes. |
| CSS variable updates accidentally become lifecycle inputs | Apply appearance through a cold owner; verify no renderer/session/controller remount. |

## Definition of done

- [x] Espresso Aero is the default name and appearance in both modes.
- [x] One declarative theme defines shared appearance; component CSS contains
  local structure and justified semantic exceptions, not competing materials.
- [x] Walnut, glass, wells, flat brass controls, and metal details follow this guide
  or an explicitly recorded user-approved revision.
- [x] Reduced transparency, opaque fallback, reduced motion, readable text, and
  distinct keyboard focus are verified.
- [x] Alternate fixture application proves configurability without user CSS or
  a shipped settings editor.
- [x] Layout, input, lifecycle, and world visualization behavior remain intact.
- [x] `npm run test:ts -- <affected suites>`, `npm run check`,
  `npm run lint:ts`, `npm run lint:dead`, and formatting checks pass.
- [x] `npm run harness:browser -- --client-hud --brief`, the new specimen
  invocation, and representative Explorer browser coverage pass.
- [x] Real-GPU performance evidence records configuration, sample spread, and
  the chosen transparency tradeoff.
- [x] Durable style documentation identifies extension rules and deferred work.

## Open questions and proposed defaults

- **Wood prominence:** resolved to a narrow window-header strip.
- **Glass intensity:** final appearance and measured performance tradeoff approved;
  retain the current 12px blur default and reduced-transparency preference.
- **User settings delivery:** persistence and an in-app editor remain a separate
  follow-up. This work supplies the configuration seam and presentation preference.
- **Performance threshold:** the measured normal-window and full-modal tradeoffs
  are accepted for the tested workload; no universal hardware budget is asserted.

## Decisions and course corrections

### Final acceptance

The user reviewed the final Explorer and texture-modal captures and approved
retaining the current glass default ("looks fine"). This closes the last
acceptance gate without further code changes. All six phases and the definition
of done are complete. The documented coverage concession and deferred per-install
settings work remain unchanged. Changes are not staged or committed.

### Final implementation audit

Completion audit resteer: the texture modal screenshot showed a lower frame-rate
readout soon after opening. The existing Frame-panel measurements do not distinguish
modal readback/startup work from steady large-area filtering cost. The native probe
now also accepts a `modal` workload: it settles the readback before each paired
measurement and captures browser frames/compositor spans while the full modal is
open. Renderer export follows modal dismissal, so that aggregate includes some
non-modal frames and is attribution context, not an exact modal-only GPU measurement.
Do not treat the small-window result as proof of the full-modal tradeoff.

The settled-modal run passed with five samples per preference and no application
errors (`/tmp/espresso-explorer-modal-cost.json` and its ten traces). It uses the
same GPU, camera, scene, scale, and viewport described below, waits 1.5 seconds
after each modal readback, and measures 3 seconds with the full dialog open.

| Modal-only browser metric, milliseconds | Glass median (min–max) | Opaque median (min–max) |
| --- | --- | --- |
| Animation-frame median | 16.70 (16.70–16.70) | 16.70 (16.70–16.70) |
| Animation-frame p95 | 16.80 (16.70–16.80) | 16.70 (16.70–16.80) |
| Browser task duration / sampled frame | 4.881 (4.655–5.536) | 4.485 (4.306–4.574) |
| Compositor Display::DrawAndSwap mean span | 0.586 (0.574–0.713) | 0.346 (0.345–0.399) |

Renderer export context: GPU mean 3.863ms glass (3.783–3.965), 3.835ms opaque
(3.775–3.862); CPU mean 2.850ms glass (2.685–3.063), 2.489ms opaque
(2.377–2.512). These aggregates include the surrounding frames noted above.
The initial low-rate screenshot did not represent sustained modal cadence during
the settled windows. Recommendation remains unchanged: keep 12px blur, accepting
approximately 0.24ms additional median compositor span for this full-modal workload.
Neither this result nor the ordinary-panel result claims a universal hardware budget.

The durable `apps/holtburger-3d/UI_STYLE_GUIDE.md` is linked from the app README.
It documents every edit point, recipe family, preference, native-modal constraint,
semantic visualization exception, and deferred per-install settings concern.
The legacy stylesheet imports/classes/variables have no surviving source or script
consumers. Historical entries below describe superseded stages, not current
instructions. No brittle default-palette tests were found; the seven theme tests
use explicit authored fixtures. The specimen now consumes the production HUD-input
modifier and no longer claims production styling is unchanged.

After cleanup, the complete client browser suite passed at
`/tmp/espresso-aero-clean-client.png`, including its actual startup/character/runtime
captures. The native Explorer probe also passed again at
`/tmp/espresso-explorer-clean.json`; all tabs, dense scrolling, texture modal
selection/focus/restoration, and canvas identity passed without application errors.
That repeated ten-sample run corroborated the earlier tradeoff: median compositor
DrawAndSwap 0.515ms glass (0.466–0.517) versus 0.313ms opaque (0.311–0.320).
Renderer GPU ranges overlapped: 3.777ms glass (3.745–3.809), 3.845ms opaque
(3.747–3.893). This is not evidence that blur speeds up WebGL work.
Frame p95 remained approximately 16.7–16.8ms.

The final GPU specimen passed the complete contrast/interaction/fallback suite.
Handoff artifacts are `/tmp/espresso-aero-handoff-specimen.png.*.png` and
`/tmp/espresso-aero-handoff-specimen-report.json`; the client report is
`/tmp/espresso-aero-clean-client-report.json`.
Sampled text reached at least 5.045:1, essential boundaries 3.511:1, and focus
rings 6.048:1 across the tested backgrounds/configurations. Actual world and bright
captures were inspected. Eighty-six affected unit tests passed across ten files.
Final Svelte/TypeScript, ESLint, Knip, formatting, and whitespace checks passed.
Final acceptance retained the default with the recorded device/workload cost.
No further source changes were required.

Coverage concession: live catalog-driven entity spawning could not be exercised
because the installed catalog format is unsupported. Its visible error/disabled
state was inspected; picker, entity-panel state, input, and lifecycle behavior
retain focused unit coverage. This task does not repair or reinterpret catalog
formats. Per-install persistence and settings UI remain explicitly out of scope.

### Final cleanup sequencing

All phase 5 implementation/measurement tasks have evidence. The measured default
is unchanged from the approved specimen, so safe cleanup proceeds before the final
transparency signoff; that review should see the finished artifact, not disconnected
legacy files. This moves the remaining acceptance decision to the final handoff
without silently treating it as approved.

The disconnected legacy palette and material sheets are removed. The retired
unprovenanced panel image was moved to `/tmp/espresso-aero-retired-panel-texture.jpg`
and is also recoverable from git. It has no surviving runtime consumer. Unused
primary-button styling and superseded bevel/raised-control contract comments are
removed. The current frame uses original procedural CSS, with no external font
or bitmap dependency.

### Explorer performance evidence and tradeoff

The corrected native probe passed against real Explorer content with no application
errors. Evidence is `/tmp/espresso-explorer-final.json`, with six tab captures,
scrolled captures, a full-viewport texture dialog, and ten compositor traces.
The dialog preview was 816 CSS pixels wide, native focus stayed inside the modal,
Escape restored its opener, and selecting the second placement changed selection.
The game canvas retained identity across all preference changes.

Reproduce from the app directory:

```sh
HOLTBURGER_ELECTRON_REMOTE_DEBUGGING_PORT=0 npm run dev:explorer
# Read the loopback port from the printed DevTools endpoint, then in another terminal:
npm run probe:explorer:theme -- <port> /tmp/espresso-explorer
```

The probe requests `0xda55ffff` with every residency radius at 1 through the
actual World controls. Measurements use the populated Frame panel, stationary
camera [42000, 68, -16368], yaw -0.785398, pitch -0.615480 radians, fixed day/time,
render scale 1, requested device scale 1, and 1280×720 visible viewport.
Electron reported a 1280×721 drawing buffer (fractional CSS height 720.787).
GPU: AMD Radeon 780M, ANGLE/radeonsi phoenix ACO, OpenGL ES 3.2.
Five 3-second samples per preference alternate order; renderer profiling resets
between samples. No competing browser/GPU benchmark ran during these windows.

| Per-sample metric, milliseconds | Glass median (min–max) | Opaque median (min–max) |
| --- | --- | --- |
| Browser animation-frame median | 16.70 (16.70–16.70) | 16.70 (16.70–16.70) |
| Browser animation-frame p95 | 16.70 (16.70–16.80) | 16.70 (16.70–16.80) |
| Browser task duration / sampled frame | 4.234 (4.219–4.513) | 4.184 (4.072–4.280) |
| Renderer CPU mean | 2.394 (2.327–2.527) | 2.311 (2.263–2.364) |
| Renderer GPU measured-span mean | 3.772 (3.695–3.852) | 3.751 (3.707–3.832) |
| Compositor Display::DrawAndSwap mean span | 0.523 (0.453–0.554) | 0.312 (0.294–0.336) |

The compositor row is the mean complete-event duration for that single named
trace boundary, not a sum of overlapping trace categories or GPU wall time.
Renderer GPU spans exclude CSS filtering. Median display/compositor CPU work
increased by approximately 0.21ms; this workload retained its 60Hz cadence.
Recommendation: retain the approved 12px glass default and explicit reduced-
transparency path. This is a measured device/workload tradeoff, not a universal
frame budget or a claim about low-end hardware. The user subsequently approved
this tradeoff at final acceptance.

Additional native pointer evidence (`/tmp/espresso-explorer-motion.json`) verified
camera yaw/pitch changes over the same scene without moving its position, minimap
resizing from 220 to 244 CSS pixels, and texture-preview repaint after both pan and
wheel zoom. Native Tab remained inside the dialog. Captures:
`/tmp/espresso-explorer-moving-world.png` and
`/tmp/espresso-explorer-modal-pan-zoom-focus.png`. These post-measurement interactions
did not contaminate the fixed-camera timing windows.

### Explorer cutover in progress

Phase 5 implementation is underway. Both mode entries and the combined browser
harness now load only the structural base sheet; the shared mount marks the
application root for theme recipes. Explorer tools, tabs, forms, entity controls,
texture modal chrome, and the frame readout have moved off legacy classes.
Parameter-row geometry is Explorer-owned, not promoted into a generic UI framework.
The tools window gains the same narrow frame header as client windows.

The custom metallic range tracks/thumbs are removed in favor of native sliders
with shared accent/focus styling. Disclosure groups remain compact and borderless
apart from a separator; only genuine windows use glass. Texture atlas canvas
checkerboarding, bounds, and placement highlights remain semantic visualization,
not UI palette consumers. No renderer or host behavior changes are intended.

Type/Svelte checking passes after this first cutover. Browser verification,
complete local-style/interaction-state review, and repeated compositor measurements
are still pending; phase 5 is not complete. Legacy stylesheet files and their
unprovenanced image are now disconnected, with removal tracked in phase 6.

The first actual Electron Explorer inspection found a material/layout conflict:
the readout recipe's relative positioning overrode the frame counter's absolute
position, placing it above the viewport. The decoration-containing-block default
now uses low specificity so component placement wins. A removed fieldset reset
also exposed native enclosing borders; the Explorer-owned border reset is restored.
These corrections need the subsequent native run, not just specimen evidence.

The combined client browser harness passed after disconnecting legacy styles
(`/tmp/espresso-aero-explorer-cutover-client.png`), with preserved theme-update
identity, window drag/resize, and no application console errors. The first actual
Explorer tab sweep rendered every tab and populated frame/texture data without
browser exceptions. Its initial scene had no requested content; it is explicitly
not representative performance evidence.

Local-data limitation: the real Explorer reports that `dats/weenies.hwc` uses
unsupported format version 8. This prevents catalog-driven spawning in that
session. Do not change host/catalog compatibility as part of theming. Record the
missing live entity coverage and use existing production-component fixtures where
practical.

A focused `probe:explorer:theme` script now attaches to the real Electron
Explorer. It requests a fixed scene through production UI, sweeps tabs and the
texture readback modal, and alternates five glass/opaque samples. Each captures
native frame intervals, browser task metrics/compositor traces, and the production
renderer report. The common Electron diagnostic CDP connection was extracted from
the existing live-client probe rather than copied into a third implementation.
Run it after formatting and never edit app source during a capture.

The first populated-scene screenshot exposed a second compositing issue:
`backdrop-filter` makes a containing block for fixed descendants, confining the
texture modal to the tools window. The texture inspector now uses native
`dialog.showModal()` and the browser top layer, retaining its existing component
state and input-gate lease. Escape uses native dialog cancellation; focus containment
and restoration become native rather than requiring a custom portal/window manager.
The nested-glass suppression excludes top-layer modals because their DOM ancestry
no longer describes their compositing ancestry. The probe now checks modal preview
width and focus behavior, not just successful clicking. The initial modal screenshot
was defective and does not establish phase acceptance.

Native dialog verification refined the close sequence: let the browser close
the connected dialog and restore focus before its close event removes the Svelte
component. Removing the component directly during cancel loses that restoration.
The CDP probe must include native Escape key codes; a DOM key string alone reached
the old window listener but did not exercise the browser's dialog default action.
The final implementation needs neither a window key listener nor a manual focus stack.

### Client cutover after visual approval

The user approved continuing after the fading HUD revision. The shared mount
entry now publishes theme variables before any components mount, without adding
reactive lifecycle dependencies. Only migrated roots opt into recipe classes.
Client components remove replaced material CSS rather than layering theme
overrides on legacy classes. Existing geometry, input, and runtime data paths
are preserved.

Minimap DOM chrome and ToggleField are shared consumers; their cutover also
changes those two components in Explorer. The rest of Explorer retains its
legacy styling until phase 5. This bounded sequencing avoids duplicate recipes
or fallback variables for a shared component. Minimap canvas/SVG game-semantic
paints, navigation, and map data remain unchanged.

Chat continues to consume its existing semantic message roles. Most colors map
to existing palette roles; tell, allegiance, and society text receive three
distinct named theme colors. No message classification moves into styling.
Client main now imports only base.css for structural browser defaults; it no
longer loads the legacy palette/material sheets. Explorer's legacy theme imports
that same reset during the staged cutover. The combined browser harness still
loads Explorer CSS, so its client checks also exercise that coexistence.

Verified with:

```sh
npm run harness:browser -- --client-hud --brief --screenshot /tmp/espresso-aero-client.png
npm run harness:browser -- --ui-theme --gpu --viewport-width 1280 --viewport-height 807 --building-radius 1 --camera-height 28 --camera-pitch -15 --camera-yaw 35 --settle-ms 2000 --screenshot /tmp/espresso-aero-cutover-specimen.png
```

The client interaction suite passed with no application console errors. New
captures include .runtime.png (real diagnostics window), .characters.png
(production selection controls with fixture data), and .startup.png (actual
client startup/error shell with an intentionally failing local host bridge).
The base screenshot shows layout editing; existing narrow/constrained captures
remain available. No live server connection was attempted by these fixtures.

Native diagnostics dragging moved the window by (-30,-20); native resizing
increased its extent by (24,16). Applying an alternate accent and reduced
transparency preserved the client canvas and HUD rectangles, then restored the
default theme. Explicit character selection enabled entry, and entry published
the pending state. Lifecycle transition semantics are also covered by unit tests.

The GPU specimen retained its contrast, fallback, focus, pointer, and live-world
checks. Fifty-seven tests across theme, HUD layout, chat policy, lifecycle state,
and lifecycle session passed. Type/Svelte checks, ESLint, Knip, formatting, and
whitespace checks passed. This is correctness/appearance evidence, not a
compositor performance result.

Remaining work: phase 5 migrates the rest of Explorer and measures transparency
cost; phase 6 removes the remaining legacy vocabulary/assets and publishes the
durable style guide. No compatibility aliases were added for migrated client
components. Existing renderer/map semantic paint remains outside UI theming.

### Fading HUD backings

The flat charcoal/brass direction is retained. The current character name strip
already fades horizontally (ClientCharacterHud.svelte), and chat fades vertically
(ClientChat.svelte). The specimen now extends that treatment to readouts and
glyph controls. Readout fading is outside the content box, preserving the
contrast of the text itself. Decorative pseudo-elements cannot intercept input
and are isolated behind their owning control, not behind the whole HUD.
The current toast still has a framed solid backing; its gradient treatment is
a deliberate design revision, not a claim that every current HUD already fades.
The complete GPU probe passed using the flat revision's invocation with
--screenshot /tmp/espresso-aero-faded.png. World and bright screenshots were
visually inspected at 1280×720. Sampled informational text reached at least
5.05:1; control boundaries and focus rings remained above their 3:1 targets.
Native interactions, reduced transparency/motion, and opaque fallback passed
with no application console errors. Evidence: /tmp/espresso-aero-faded-report.json.
Seven theme tests, Svelte/TypeScript checks, ESLint, formatting, and whitespace
checks passed. Production UI is unchanged; visual approval is still pending.

### Flat charcoal and brass revision

The borderless HUD structure is retained, but the user rejected the remaining
simulated depth and brown-heavy palette. Window buttons now use flat muted
brass fills; HUD actions use brass glyphs. Surfaces and reading wells are neutral
charcoal. Window headers carry only a thin walnut strip. Meter gradients,
control bevels, and inset well shadows are removed. Default gloss is zero and
external shadow strength is reduced; glass opacity and blur are unchanged.
Earlier screenshots remain historical evidence, not the current visual proposal.

Validated with the same 1280×807 browser invocation as the overlay revision,
using --screenshot /tmp/espresso-aero-flat.png (visible viewport 1280×720).
World and bright screenshots were visually inspected. The complete GPU probe
passed, including all backdrop variants, native focus, submission, drag/resize,
overlap, reduced transparency/motion, and opaque fallback. Sampled text reached
at least 5.10:1, control boundaries 3.51:1, and focus rings 6.05:1.
No application console errors occurred. JSON:
/tmp/espresso-aero-flat-report.json.

Seven theme tests, Svelte/TypeScript checks, ESLint, formatting, and whitespace
checks passed. Production UI remains unchanged; stop for visual approval.

### Borderless overlay revision

The compact revision retained too much framing. Inspection of the current
ClientCharacterHud, ClientChat, and ClientShortcutDock showed that empty space
within their layout rectangles is deliberately unpainted or fades into the game.
The specimen now follows that presentation structure, not only their dimensions.
ClientSelectedEntityHud is more framed than those peers; the requested direction
deliberately simplifies its treatment rather than copying that frame.

Shared window recipes remain available for diagnostics and the overlap-test
window. HUD readouts and glyph controls have their own borderless recipes.
The palette is warmer and default window opacity starts at 0.74 instead of
0.88; the reduced-transparency path still resolves to opaque backing.
Earlier results below describe superseded designs, not acceptance of this revision.

Reproduce from apps/holtburger-3d:

```sh
npm run harness:browser -- --ui-theme --gpu \
  --viewport-width 1280 --viewport-height 807 \
  --building-radius 1 --camera-height 28 --camera-pitch -15 --camera-yaw 35 \
  --settle-ms 2000 --screenshot /tmp/espresso-aero-overlay.png
```

The full probe passed at a visible 1280×720 viewport on AMD Radeon 780M
(RADV PHOENIX), device scale 1. World and bright screenshots were inspected.
The glyph-free backing samples now also cover health numbers, target name,
and FPS. Across the five material/background variants, sampled text reached
at least 5.13:1, window-button boundaries 3.46:1, and focus rings 6.58:1.
The increased transparency required a lighter warm window-edge color, not
additional HUD borders. Keyboard focus, chat submission, window drag/resize,
overlap, reduced transparency/motion, and opaque fallback passed.
No application console errors occurred. Evidence:
/tmp/espresso-aero-overlay-report.json.

The unchanged --client-hud --brief harness also passed and supplied a current
UI reference screenshot at /tmp/current-client-hud-reference.png. That capture
includes layout-edit handles, which are not ordinary HUD decoration.
Seven theme tests, Svelte/TypeScript checks, ESLint, Knip, and formatting passed.
Production migration remains paused for visual approval.

### Compact HUD revision (2026-09-05)

The first specimen was rejected for taking desktop Vista proportions too
literally. Its large cards, headings, stacked form labels, and generous padding
are not the desired client UI. Keep Espresso Aero's palette and materials;
use Vista as a finish reference, not a component-layout reference.

The revised specimen consumes CLIENT_UI_DEFAULTS through the existing HUD
placement helpers. Character, target, chat, frame-rate, notification, and shortcut
surfaces use client footprints; the control-state sheet fits the diagnostics
window. Shared recipes are compact by default. Production UI remains unchanged.
The previous evidence below describes the rejected first composition, not
approval of the revised appearance.

Reproduce the revised specimen from apps/holtburger-3d:

```sh
npm run harness:browser -- --ui-theme --gpu \
  --viewport-width 1440 --viewport-height 900 \
  --building-radius 1 --camera-height 28 --camera-pitch -15 --camera-yaw 35 \
  --settle-ms 2000 --screenshot /tmp/espresso-aero-compact.png
```

The complete probe passed on AMD Radeon 780M (RADV PHOENIX), device scale 1,
with a 1440×813 visible screenshot and 1440×900 game canvas. The five backdrop/
material variants reached minima of 4.65:1 for sampled informational text,
3.30:1 for the sampled control boundary, and 10.62:1 for the focus ring. Native
Tab, chat submission, drag, resize, overlap hit-testing, contained resize-handle
focus, reduced motion/transparency, and opaque fallback all passed. The moving
world retained its canvas. No application console errors were reported.
The JSON evidence is at /tmp/espresso-aero-compact-report.json.

A second complete run passed at a 1280×720 visible viewport, using
--viewport-width 1280 --viewport-height 807 and
--screenshot /tmp/espresso-aero-compact-720.png (the extra 87px accounts for
this headless Chrome window's chrome). Its JSON evidence is at
/tmp/espresso-aero-compact-720-report.json. Both world and bright screenshots
were visually inspected; client footprints and dense controls remain legible.

The density revision also exposed an oversized focus offset; it is now 2px,
and the contrast probe reads the actual outline geometry from CSS instead of
assuming the original spacing. The standalone tooltip explicitly participates
in specimen hit-testing so its composited contrast can be sampled.

Seven theme unit tests, Svelte/TypeScript checks, ESLint, Knip, formatting, and
whitespace checks passed. These are specimen results, not approval of production
migration or a performance benchmark. Stop for user visual review.

### First visual checkpoint: evidence and review

Run from apps/holtburger-3d:

```sh
npm run harness:browser -- --ui-theme --gpu \
  --viewport-width 1440 --viewport-height 1380 \
  --building-radius 1 --camera-height 28 --camera-pitch -15 --camera-yaw 35 \
  --settle-ms 2000 --screenshot /tmp/espresso-aero-review.png
```

This runs the normal game-content harness with a theme specimen above it.
It saves .world.png, .world-motion.png, .bright.png, .dark.png, .opaque.png,
.texture-free.png, and .fallback.png beside the chosen screenshot path.
The additional *-backing.png files contain the glyph-free composited backgrounds
used for contrast sampling. Artifacts in /tmp are review output, not checked-in
assets; rerun the command to reproduce them.
The final successful JSON evidence is also retained for this review at
/tmp/espresso-aero-review-report.json.

For an asset-free interactive preview, run npm run dev:vite and open
/harness/browser/?ui-theme=1 on the printed local URL. The backdrop selector,
opaque-surfaces toggle, and texture-free fixture toggle are harness controls,
not a shipped theme editor. Use the automated invocation for the live game view.

Verified on 2026-09-05:

- Seven theme unit tests passed; npm run check reported zero errors/warnings.
  ESLint and Knip passed. Formatting and whitespace checks passed.
- The existing --client-hud --brief browser harness passed with no application
  console errors, verifying that the opt-in specimen did not replace production UI.
- The complete --ui-theme probe passed on ANGLE/Vulkan with AMD Radeon 780M
  (RADV PHOENIX), device scale 1. The game canvas was 1440×1380; headless Chrome's
  visible screenshot was 1440×1293. This is visual/interaction evidence, not a
  performance benchmark. Phase 5's repeated cost measurements remain deferred.
- Live outdoor content was 0xda55ffff, camera [41952, 28, -16416], yaw 35°,
  pitch -15°. The motion probe advanced the camera through 30 rendered frames
  to yaw 50°, retained the canvas, then restored the starting pose.
- Across the five main variants, the lowest sampled informational-text ratio
  was 4.97:1 (secondary glass text on the bright backdrop); the sampled essential
  control boundary reached at least 3.40:1 and focus ring at least 10.73:1.
  These numbers describe this specimen/configuration, not every possible theme,
  scene, or future component.
- Native Tab exposed the theme focus ring. Native pointer dispatch submitted
  chat, moved the overlapping window by the requested displacement, resized it,
  and reached its frontmost button. The resize handle's ring fits inside the
  clipping surface.
- Reduced transparency resolved backdrop-filter to none; reduced motion resolved
  control transition duration to zero. Suppressing the @supports enhancement
  exercised the actual opaque baseline declarations (not an unsupported browser
  emulation claim). The fallback screenshot was inspected.
- A real DOM probe verified invalid numeric configuration is rejected before
  mutation and valid updates preserve unrelated inline styles and child identity.
- Screenshots were inspected for the world, bright, texture-free, and fallback
  variants. The alternate fixture changes the palette and removes grain using
  the same recipe sheet. User aesthetic approval is intentionally still open.

Concessions and corrections:

- CSS grain provides a restrained linear walnut suggestion, not photoreal wood.
  Whether it needs an original grain asset is a visual-review decision.
- A browser-native CSS resize experiment did not resize under pointer dispatch.
  It was removed in favor of the existing trackPointerGesture primitive used by
  production HUD controls. No claim is made about general browser resize support.
- Contrast sampling initially caught the disabled label partway through its
  fade-to-transparent transition. Glyph-free backing capture now disables that
  transition and flushes restoration; theme-state captures finish CSS transitions
  before measuring. Readability thresholds were not weakened.
- The specimen uses a small clipped/resizable test window, not a replacement
  window manager. Its geometry and fixture text remain harness-owned.
- A late focus-containment check moved the resize affordance inward so its
  outline is not clipped by the glass surface.

Next-phase steering and remaining debt:

- Do not apply Espresso Aero to either production root until the user approves
  this checkpoint. The shared legacy stylesheet and local legacy treatments
  intentionally remain live only on their existing consumers.
- Keep ui-theme-recipes.css opt-in during review; subsequent cutovers should
  delete superseded recipes rather than alias old variables to new ones.
- The foundation has 17 color roles, three font stacks, two radii, five material
  parameters, and identity metadata. Each appearance field has a recipe consumer;
  no per-panel appearance overrides or texture registry were introduced.
- Client migration should begin with HudWindow/Panel chrome and shared control
  recipes, then local content surfaces. Keep existing placement/resizing/input
  owners; do not import the specimen's positioning into production.
- When migrating chat, introduce only the independent message-role palette
  entries required by the existing ClientChatTone contract. Do not reuse vital
  colors simply because today's hue happens to match.
- Explorer imports share the old theme sheet. Land its root application together
  with the corresponding material cutover; otherwise global button defaults and
  scoped controls could accidentally form a mixed theme.
- Dense-layout fit, complete per-component state/contrast coverage, setting
  persistence, and repeated blur/compositor cost measurements are not claimed
  complete at this checkpoint.

### Execution inventory and chronological decisions

- Phase 1 implementation exists: ui-theme-contract.ts, themes/espresso-aero.ts,
  ui-theme.ts, and fixture-driven ui-theme.test.ts. Numeric values are validated
  before root mutation; color construction reuses the frontend hex-color type.
- Phase 2 now has UiThemeSpecimen.svelte and UiThemeHarness.svelte, plus
  --ui-theme in the canonical browser harness. Live content uses the existing
  BrowserHarnessApp behind the opt-in specimen rather than a separate renderer.
- The state sheet forces real CSS pseudo-states through CDP to show hover,
  pressed, and focus simultaneously. Native keyboard/pointer checks are separate
  from that staging; no second specimen-only material recipe is maintained.
- Initial browser passes verified composited text samples over world, white,
  dark, opaque, and texture-free backgrounds. The first click failure exposed a
  probe coordinate outside the visible viewport; native interaction probes now
  bring targets into view. The final verification above includes this correction.
- Reading wells are intentionally opaque. Frame grain is currently fine linear
  CSS grain rather than an organic bitmap; realism and gloss intensity are
  explicit visual-review questions, not silently settled aesthetic requirements.

- Shared recipes: root buttons/focus in theme.css; panels/title bars/forms in
  ui.css; client chat, selected target, shortcut buttons, jump power, vitals,
  notifications, and layout handles currently duplicate these treatments.
- Local geometry to retain: HUD anchor/resize code, panel content grids, minimap
  position/diameter, Explorer tab arrangement, and startup-panel dimensions.
- Semantic exclusions: chat classification in client-chat-policy.ts, map paint
  in map-appearance.ts, world target outlines, and renderer effects. Existing
  DOM status roles get appearance values; their classification stays put.
- Explorer migration targets include explorer.css tab/error chrome and local
  form/modal styles. Both mode entry points and the browser harness import the
  legacy CSS, so new recipes are opt-in under .ui-theme until visual approval.
- Inspected ac-panel-bg-tile.jpg: mottled stone/leather-like detail rather than
  longitudinal wood. Git traces it to scaffolding, without asset provenance.
  Do not reuse it in Espresso Aero. Leave the existing production consumer
  intact; the new frame uses original procedural CSS grain, with strength zero
  providing the texture-free path. No new bitmap asset is needed at this stage.
- Foundation is app-local typed theme data plus pure CSS-variable projection
  and explicit root application. Existing HexRgbColor constructors are reused.
- Temporary staging debt: ui-theme-recipes.css is a separate opt-in stylesheet
  instead of overwriting ui.css before approval. Consolidate/delete superseded
  recipes during the client/Explorer cutovers, not by adding compatibility aliases.

- Agreed direction: Espresso Aero, with walnut details to retain an Asheron's
  Call character; wood frames glass rather than covering reading surfaces.
- Proposed sequence: foundation and specimen, user visual review, client
  cutover, Explorer cutover, cleanup. Update this section as execution discovers
  concrete constraints or the user approves changes.
