# Color Grading Presentation Plan

## Context & Boundaries

**Goal**: Add a deliberate, hand-tunable color grade to the 3D frontend — parametric ops plus
spline curves applied once at scene presentation — with an Explorer panel for live tuning and a
copy-to-clipboard export that pastes into `frontend-tuning.ts`.

This is a deliberate presentation departure from retail, which had no grading of any kind: the
retail pipeline computes clamped gamma-space lighting and displays it as-is. The grade is
frontend policy, defaults to identity/off, and never alters world data, lighting math, or any
authored value upstream of presentation.

### In Scope

- One final scene target for both render paths (flat and portal), so a single presentation pass
  sees every drawn fragment — opaque, portal composite, blended, and particles.
- A grade stage in that presentation pass: white balance → tone/channel curves → saturation →
  dither, LDR in / LDR out.
- Monotone cubic spline curves (master + R/G/B), baked to a small 1D LUT texture on change.
- `FrameSettings.colorGrade` wiring from Explorer through the runtime, following the
  ambient-occlusion precedent.
- Explorer grading panel: enable toggle, parametric sliders, Krita-style curve editor,
  copy-to-clipboard export shaped as an `EXPLORER_TUNING_OVERRIDES` fragment.
- Defaults in `EXPLORER_TUNING_OVERRIDES.colorGrade` (identity until a look is tuned and pasted).

### Out of Scope

- HDR/linear-light pipeline conversion, bloom, exposure adaptation, or any change to lighting
  math. The grade consumes the existing clamped LDR scene.
- 3D LUT import/export, HALD images, or external tool round-trips (superseded by in-Explorer
  tuning; revisit only if parametric + curves prove insufficient).
- A clean-screenshot command. The unified scene target makes a pre-grade capture trivial later,
  but it ships separately if ever wanted.
- Histogram/scope overlays in the panel.
- Grading harness UI or TUI concerns.

## Ground Truth

### Reference Sources

- `apps/holtburger-3d/src/lib/game/renderer/webgl2-flat-scene-presentation.ts` — the present
  pass the grade lands in (fullscreen triangle, `texelFetch` copy, depth republish).
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts` — `#drawFlatView`
  (~line 2305) and `#executePortalScopeAtlasFrame` (~line 1211): the two end-of-frame
  sequences this plan restructures. Note both currently draw blended objects and particles into
  the **default framebuffer after** the offscreen scene is presented/composited — this is why
  a grade confined to today's present shader would miss every translucent fragment.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-portal-scope-atlas-pipeline.ts` —
  `execute(outputFramebuffer)` / `beginDeferredScene(outputFramebuffer)` already accept an
  arbitrary framebuffer, which is what lets the portal path retarget to the flat scene target.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-flat-scene-target.ts` — the RGBA8 +
  `DEPTH_COMPONENT24` target set (no stencil attachment) that becomes the single final scene
  target.
- `apps/holtburger-3d/src/lib/game/renderer/portal-scope-atlas-command-model.ts` — the
  resolve stage binds the output framebuffer with stencil-test explicitly disabled and depth
  writes enabled, so the composite writes real depth into the output and needs no stencil.
  Verified during dry run: the flat target's missing stencil is a non-issue.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-device.ts:106` — context is created with
  `antialias: false` (and `alpha: false`, `stencil: true`). No multisampling means byte-parity
  across the restructure is genuinely achievable; no destination alpha in the backbuffer, and
  dry run confirmed no blend policy uses `DST_ALPHA` anywhere, so drawing blended content into
  an alpha-bearing RGBA8 target is arithmetic-identical.
- Retail behavior note: retail presents its clamped fixed-function output directly (no grade,
  no tone map). The grade is enabled-off by default and identity when off, so retail-faithful
  output remains one toggle away. This is presentation policy, not a lighting/content
  divergence, but the departure gets recorded in the tuning-file comment.

### Existing Patterns

- `ambient-occlusion-policy.ts` — the settings-module precedent: validated parameter type,
  `Settings = { enabled, parameters }`, defaults sourced from `SHARED_FRONTEND_TUNING`, loud
  validation errors. `colorGrade` mirrors this shape.
- `renderer.ts` `FrameSettings` / `SHARED_FRAME_SETTINGS` — where the new `colorGrade` field
  and its tuning-sourced default live.
- `ExplorerApp.svelte` (`frameSettings` `$state` + `applyFrameSettings()`) and
  `ExplorerWorldPanel.svelte` (AO slider wiring) — the panel-to-runtime plumbing precedent.
- `webgl2-sao-pass.ts` — precedent for a pass owning small GPU resources with explicit
  destroy and generation metrics.
- `SHARED_FRONTEND_TUNING.rendering.skyParticles` / `weather` — precedent for commented,
  deliberately-ours presentation knobs.

## North Stars

1. **One grade, one place.** Every rendered fragment passes through the presentation grade
   exactly once. No per-material grading, no "remember to grade" invariant smeared across
   shaders.
2. **Off means bit-exact off.** With the grade disabled, presentation output is byte-identical
   to today's. The A/B toggle is only honest if the off state is the true baseline.
3. **The tuned look is source code.** Export lands as a readable `EXPLORER_TUNING_OVERRIDES` fragment —
   diffable, greppable, reviewable. No binary artifacts.
4. **Curves cannot be deranged.** Monotone interpolation, clamped domain, validated control
   points. A curve the editor can produce is a curve the renderer can safely bake.
5. **Explorer may be a standalone publication.** The panel never assumes a dev checkout or
   writable source tree; clipboard is the only export channel.
6. **Restructure first, grade second.** The end-of-frame unification is a behavior-preserving
   refactor proven by screenshots before any grading code exists to confuse the evidence.
7. **Hot paths stay allocation-free.** LUT bakes only on settings change; per-frame work is
   uniform uploads and texture binds.

## Phased Implementation

### Phase 1: Grade domain model (pure TS, no GPU)

Everything the shader and panel will consume, as pure tested functions.

**Deliverables**

- `src/lib/game/renderer/color-grade-policy.ts`:
  - `ColorGradeCurve` — control points (`{x, y}[]`, x strictly increasing, both in [0, 1]).
  - `ColorGradeParameters` — `temperature`, `tint`, `saturation`, curves
    (`master`, `red`, `green`, `blue`).
  - `ColorGradeSettings` — `{ enabled, parameters }` (AO-shaped).
  - `createColorGradeParameters(...)` validation: finite values, documented ranges, per-curve
    point count ≥ 2, sorted unique x, endpoints spanning [0, 1]. One failure mode per error
    message, each reachable by a test input.
  - Monotone cubic (Fritsch–Carlson) curve evaluator.
  - `bakeColorGradeStrips(parameters, out: Float32Array)` — composes `channel(master(x))` into
    a 256-entry strip, writing into a caller-owned buffer.
  - `temperatureTintToGains(temperature, tint)` — CPU-side white-balance RGB gains,
    normalized to preserve luma so white balance does not double as exposure.
- `EXPLORER_TUNING_OVERRIDES.colorGrade` — identity defaults, `enabledByDefault: false`,
  with a comment recording that this is a deliberate presentation departure from retail's
  ungraded output.
- Colocated tests: evaluator monotonicity/endpoint/identity properties, bake composition,
  validation rejection cases, white-balance luma preservation. Use runtime constants, not
  magic numbers.

**Acceptance Criteria**

- `npm run test:ts`, `npm run check`, `npm run lint` pass.
- Identity parameters bake to a strip where `strip[i] ≈ i / 255` in every channel.

**Task Checklist**

- [x] Types + validation + defaults
- [x] Monotone evaluator + bake + white-balance gains
- [x] Tests (18, all passing; full suite 1327 passing)
- [x] `EXPLORER_TUNING_OVERRIDES.colorGrade` block

**Decisions and Course Corrections**

- Saturation reuses `scene-lighting.ts`'s Rec. 601 luma. `relativeLuminance` is now exported
  alongside a new `REC_601_LUMA_WEIGHTS` const; the weights are exported separately because
  the presentation shader needs the same three numbers as GLSL literals, and two independent
  luma definitions would drift the first time either is tuned.
- Bakes RGBA texels (alpha unused, 1.0) so the buffer uploads to an RGBA16F texture without
  a repack.
- Named `bakeColorGradeStrip` (singular): it fills one buffer that becomes one texture whose
  RGB channels carry the three composed channel curves. The plan's earlier plural name
  implied three buffers.
- Monotone tangents use the local-extremum guard (zero tangent where neighboring secants
  change sign) *plus* the Fritsch-Carlson radius-3 circle projection. The circle condition
  alone prevents overshoot within a segment but not an averaged slope carrying the curve past
  a control point that is a local maximum.
- `ColorGradeSettings` is **not** defined in this phase. It had no consumer until
  `FrameSettings.colorGrade` exists, and both eslint and knip correctly rejected it as dead.
  It lands in Phase 4 beside its consumer. Same reasoning demoted `ColorGradeControlPoint`
  and `ColorGradeCurves` to module-private for now; Phase 5 exports them when the editor and
  serializer consume them.
- White balance uses a 0.3 channel swing normalized by luma. Verified by test that all four
  full-deflection corners keep every channel gain strictly positive, and that neutral input
  luma is preserved exactly, so the temperature slider is not a second exposure control.
- One test initially asserted a 3-point channel curve behaved as a straight line. It does not
  — a monotone spline through non-collinear points is not linear. Rewritten to compose two
  strictly-linear two-point curves, which also distinguishes the two composition orders
  (`red(master(x)) = 0.5 + x/4` vs. the reverse `0.25 + x/4`) rather than merely observing a
  change.

**Discovered debt (pre-existing, not introduced here)**

- `npm run format` reformats ~36 files this plan never touches. The repo's committed style
  is prettier 3.8.x, but the installed prettier resolves to 3.9.6 (`^3.8.3`), and 3.9
  collapses short leading-pipe unions onto one line. Confirmed by checking committed content
  through the project's own prettier binary. Consequence for this plan: **never run repo-wide
  `npm run format`** — format only touched files (`node_modules/.bin/prettier --write <paths>`),
  and read the Definition of Done's format gate as scoped to touched files. The repo-wide fix
  is a prettier pin or a deliberate reformat commit; either is the user's call and out of
  scope here.

### Phase 2: Unify the final scene target (behavior-preserving restructure)

Both paths end with the complete scene — including blended objects and particles — in the flat
scene target, followed by one presentation. This is the spicy phase; it ships alone, with no
grading code in sight.

**Deliverables**

- `webgl2-renderer.ts` `#drawFlatView`: move `#submitBlendedPhase` and `#drawParticleBatches`
  before `present(target)`; they draw into the flat target, depth-testing against its real
  depth attachment instead of the presented `gl_FragDepth` copy.
- `webgl2-renderer.ts` `#executePortalScopeAtlasFrame`: allocate/resize the flat scene target
  (the portal path never touches it today) and bind it as the composition output —
  `pipeline.execute(...)` / `pipeline.beginDeferredScene(...)` with the target's framebuffer —
  draw blended + scoped particles into it, then finish with the same
  `WebGL2FlatScenePresentation.present(target)` the flat path uses. The default-framebuffer
  clear at the top of the function retargets to the flat target.
- `probePortalExecution` keeps exercising the same execution path.

Dry-run findings that shape the mechanics:

- `#drawBlendedObjects` and the particle pass bind no framebuffers and set no viewports —
  they draw into whatever `DRAW_FRAMEBUFFER` is current. The flat-path change is a pure
  reorder.
- The SAO pass's `applyFlat` already leaves the flat target bound (today's after-landscape
  sky depends on that), so blended + particles slot in directly after it with no rebinding.
- The mid-frame `#beginObjectPhase()` that exists because presentation clobbers the
  object-state mirror collapses: with presentation last, one end-of-frame invalidation
  suffices.
- The executor resolve writes depth into the output framebuffer with depth writes enabled,
  which is exactly what deferred blended draws depth-test against — same contract as today's
  default framebuffer, now against the flat target's `DEPTH_COMPONENT24` attachment.

**Acceptance Criteria**

- Harness screenshots pixel-match before/after (SwiftShader, fixed camera; particles disabled
  for the byte-compare scenes, particle scenes judged visually per the AGENTS particle-viewing
  pose): one outdoor flat scene, one `envCellRenderMode: "flat"` interior, one portal-mode
  interior with visible nested portals, one blended-heavy scene.
- `--profile-renderer` confirms the presentation phase still reports, and a `--cpu-profile`
  diff shows no new per-frame allocation hot spots.
- `npm run check`, `npm run lint`, `npm run test:ts` pass.

**Task Checklist**

- [x] Flat path reorder
- [x] Portal path retarget + present
- [x] Harness parity captures (flat outdoor, flat interior, portal interior, blended fixture)
- [x] Profile sanity pass

**Parity evidence**

Captures at 1280×720, SwiftShader, `--particle-seed 7 --frame-interval-ms 16
--capture-frame 90` where the scene contains particles.

| scene | mode | run-to-run noise floor | baseline vs. after |
| --- | --- | --- | --- |
| `--fixture blended` | flat | 0 (byte-identical) | **0 (byte-identical)** |
| interior `0x7d64010e` | portal | 0.045%, max 48 | 0.053%, max 45 |
| interior `0x7d64010e` | flat | — | 0.051%, max 55 |
| outdoor town `0xda55ffff` | flat | 0.125%–0.26%, max 53 | 0.222%, max 50 |

The particle-free blended fixture is the load-bearing result: byte-identical across the
reorder. Everything else contains particles, whose emission is not reproducible even when
frozen (a known harness limitation recorded in `apps/holtburger-3d/AGENTS.md`).

The outdoor scene's 0.222% initially looked like a regression against a 0.125% floor measured
from one pair. It is not: two *post-change* runs of that scene differ from each other by
0.261%, and an independent baseline/after cross pair differs by 0.263%. The change's own
contribution is smaller than the scene's run-to-run spread, which is exactly the failure mode
the AGENTS "never conclude from a single sample" rule warns about — the first pair understated
the floor.

Visual verification: the portal interior renders its through-doorway view and blended carpet
identically, and the documented candle pose renders the flame with correct additive blending,
billboard orientation, and sorting against the candle and surrounding geometry.

Profiling (`--gpu --profile-renderer`, portal mode) reports the new presentation phase at
~0.016 ms GPU — one fullscreen triangle — with every other phase still reporting.

**Decisions and Course Corrections**

- (planned) `present()` keeps republishing depth for now; whether it is vestigial is decided
  in the cleanup phase with evidence, not assumed here. Dry-run leaning: after this phase
  nothing reads or tests default-framebuffer depth (`#beginFrame` only clears it), so
  deletion is likely.
- (planned) If portal composition into a non-default framebuffer trips undiscovered state
  (scissor, viewport, backbuffer-only assumptions), fix the pipeline contract rather than
  special-casing the renderer; `webgl2-portal-scope-atlas-executor-fixture.ts` already
  renders offscreen and is the reference for what the executor supports.
- (dry-run resolved) Antialiasing cannot break byte-parity: the context is created with
  `antialias: false`, so the previous tolerance caveat is withdrawn — parity failures are
  real regressions.
- (dry-run resolved) Stencil cannot break the retarget: the flat target has no stencil
  attachment, and the executor's resolve stage explicitly disables stencil-test at the
  output framebuffer.
- (confirmed) Portal-mode frames now also retain the flat target. Measured at 1280×720:
  `flatSceneTargetBytes` 7,372,800 (exactly 8 bytes/pixel), one framebuffer, one generation
  allocated and none disposed — no per-frame reallocation. Scales with `renderScale²`.
- Both schedules now end in a shared `#presentFlatScene(target, profile)` helper rather than
  duplicating the lazy-construct, GPU-phase, and object-state-reprime sequence. Its doc
  comment carries the invariant that makes the whole plan work: this is the frame's only
  default-framebuffer write, so anything drawn after it escapes the future grade.
- The portal path sets `gl.clearColor` explicitly before `#beginFlatOpaqueScene`. The flat
  path inherits that state from `#beginFrame`, but `probePortalExecution` reaches this
  schedule without one, so relying on the inherited value would have cleared the probe's
  target to whatever the previous frame left.
- The mid-frame `#beginObjectPhase()` collapsed as predicted: presentation is last, so the
  single reprime inside `#presentFlatScene` covers the next frame and no caller needs one.
- `probePortalExecution` now also presents, since it shares
  `#executePortalScopeAtlasFrame`. That moves the probe closer to the production path rather
  than further from it, so it was kept rather than special-cased.

### Phase 3: Resteer

- [x] Re-read the remaining phases against what Phase 2 actually revealed about end-of-frame
      state handling. Confirm the presentation pass is the sole default-framebuffer writer and
      still the right grade host.
- [x] Dry-run Phases 4–5 against the current code; adjust deliverables, naming, and
      sequencing as needed, recording changes in the affected phases.

**Findings**

- Grade host confirmed structurally, not by inspection of intent:
  `grep -rn "bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)" src/lib/game/renderer/*.ts` now
  returns exactly one non-fixture hit, `webgl2-flat-scene-presentation.ts:111`. No `execute(null)`
  or `beginDeferredScene(null)` call sites remain.
- `#drawFlatView` does not receive `FrameSettings` (only the portal schedule does). Rather
  than widen its signature, Phase 4 snapshots the grade into a renderer field at frame entry
  beside the existing `#renderScale` / `#frameTextureFiltering` snapshots, which is the
  established pattern for per-frame quality state.
- The grade reaches presentation as a `present(target, colorGrade)` argument rather than a
  separate `setColorGrade` call, so there is no ordering hazard where a caller presents
  without having pushed the current settings.
- Strip sampling needs the exact texel-center mapping `u = (v * (N - 1) + 0.5) / N`. Sampling
  at `u = v` would misread by up to half a texel, which would make an identity grade fail to
  be an identity — a bug that would only show up as a faint overall shift.
- `#beginFrame` clears the default framebuffer at frame entry, which presentation now fully
  overwrites. Added to the Phase 6 stencil/depth audit rather than removed speculatively.

### Phase 4: Grade stage in presentation

**Deliverables**

- `webgl2-flat-scene-presentation.ts`:
  - Fragment shader gains a uniform-branched grade: white-balance gains (vec3 uniform) →
    three taps of a 256×1 RGBA16F strip texture → saturation mix against Rec. 601 luma →
    interleaved-gradient-noise dither at ±0.5/255. `uGradeEnabled == 0` takes the existing
    `texelFetch` copy path untouched (north star 2).
  - Owns the strip texture; `setColorGrade(settings)` validates via the policy module, bakes
    into a retained scratch `Float32Array`, and uploads with `texSubImage2D` only when
    settings actually change (mechanism decided at implementation — reference equality is the
    likely candidate given `frameSettings` snapshots are fresh objects per update).
- `renderer.ts`: `FrameSettings.colorGrade: ColorGradeSettings`, shared defaults sourced from
  `SHARED_FRONTEND_TUNING.rendering.colorGrade` in `SHARED_FRAME_SETTINGS` and overridden by
  `EXPLORER_TUNING_OVERRIDES` for Explorer.
- `webgl2-renderer.ts`: snapshot `frameSettings.colorGrade` at frame entry alongside the other
  quality state and hand it to the presentation pass before `present()` in both paths.
- `game-runtime.ts` likely needs no change beyond the settings type flowing through
  `setFrameSettings` — verify, do not assume.

**Acceptance Criteria**

- Harness screenshot with grade disabled is byte-identical to Phase 2 output.
- A garish test grade (e.g. heavy warm temperature + crushed curve) visibly affects opaque
  terrain, portal-visible interiors, blended water/objects, and particles in one capture —
  proving single-point coverage.
- Toggling enabled off/on across frames neither leaks nor re-bakes (generation metrics /
  cpu-profile spot check).
- `npm run check`, `npm run lint`, `npm run test:ts` pass.

**Task Checklist**

- [x] Shader grade branch + dither
- [x] Strip texture ownership + change-detected bake/upload
- [x] `FrameSettings.colorGrade` plumbing end to end
- [x] Coverage capture with garish grade; disabled-state byte-parity capture

**Verification**

| check | result |
| --- | --- |
| grade disabled vs. Phase 2 output | **byte-identical** |
| identity grade *enabled* vs. disabled | max delta **1**, every difference exactly 1 |
| garish grade, flat outdoor town | terrain, buildings, alpha foliage, fog, particles all graded |
| garish grade, portal interior | root scope, through-doorway portal content, and deferred blended carpet graded identically, no seam at the composite boundary |

The identity-grade result is the sharp one. Enabling an identity grade changes nothing but the
dither: every differing pixel differs by exactly one code, with no systematic shift. That
simultaneously confirms the texel-center strip mapping carries no half-texel drift, neutral
white balance is exactly unit gain, and saturation at 1 is exact. A wrong strip mapping would
have shown a small but systematic delta instead, which is easy to mistake for "looks fine".

**Decisions and Course Corrections**

- Dither applies only when the grade is enabled, is static per pixel (no temporal term), and
  keeps captures deterministic. Banding without a grade is pre-existing and out of scope.
- RGBA16F strip, LINEAR filtered (filterable in core WebGL2 — the extension requirement is
  specific to 32F). Scene color and depth stay NEAREST and keep using `texelFetch`.
- Strip binds on texture unit 2, beside scene color (0) and depth (1), with `bindSampler(2,
  null)` so a sampler object left on that unit by another pass cannot override its filtering.
- `uColorGradeEnabled` is a uniform branch rather than a program variant: presentation runs
  once per frame, so variant compilation buys nothing.
- The grade reaches presentation as a `present(target, colorGrade)` argument, and the renderer
  snapshots `input.frameSettings.colorGrade` into `#frameColorGrade` at frame entry beside the
  other per-frame quality snapshots. `#drawFlatView` never gained a `FrameSettings` parameter.
- **White balance is resolved inside the change-detected block, not per frame.** The first
  implementation called `temperatureTintToGains` on every graded present, allocating a small
  object per frame in the render path. Gains depend only on temperature and tint, so they are
  now derived once alongside the bake and retained. Steady-state graded frames allocate
  nothing and perform only uniform writes plus two texture binds.
- `game-runtime.ts` needed no change, as predicted: `FrameSettings` flows through
  `setFrameSettings` opaquely. Three `FrameSettings` literals in `game-runtime.test.ts` needed
  the new field.
- Harness gained `--color-grade <json>` and a `setColorGrade` browser control, so any authored
  look can be exercised non-interactively without a new flag per look. Passing no flag
  presents ungraded, matching the shipped default.

### Phase 5: Explorer grading panel

**Deliverables**

- `src/explorer/explorer-color-grade.ts` — pure panel-state logic, tested:
  - Curve-editor operations: hit-test, add point (maintaining sorted x), remove point
    (floor of 2, endpoints irremovable), drag clamping to [0, 1]² and neighbor x-bounds with
    a shared minimum-separation constant so a drag can never violate the validator's
    strictly-increasing rule.
  - `serializeColorGradeTuningFragment(parameters)` — emits the paste-ready
    `colorGrade: { ... }` TS fragment, formatted to match `frontend-tuning.ts` style.
- `src/explorer/ExplorerGradingPanel.svelte` — enable toggle; temperature/tint/saturation
  sliders; SVG curve editor (identity diagonal, channel tabs for master/R/G/B, draggable
  points, click-to-add, double-click-to-remove); "Copy tuning" button via
  `navigator.clipboard.writeText`; "Reset" back to Explorer tuning defaults.
- `ExplorerApp.svelte` — `updateColorGradeSettings` following the AO update pattern.
- `ExplorerTools.svelte` — panels are tabs in its `tabs` registry (stable id, emoji icon,
  label); the grading panel mounts as a new tab entry following that pattern.

**Acceptance Criteria**

- Editing any control updates the rendered frame on the next `applyFrameSettings` (manual
  verification in Explorer; wiring-level behavior covered by the pure-function tests).
- Copied fragment pastes into `EXPLORER_TUNING_OVERRIDES` and type-checks unmodified.
- Curve editor cannot produce a state `createColorGradeParameters` rejects.
- `npm run check`, `npm run lint` (including svelte-check), `npm run test:ts` pass.

**Task Checklist**

- [x] Pure editor-state module + tests (13)
- [x] Serializer + test
- [x] Panel component + curve editor SVG
- [x] ExplorerApp wiring + panel mount (new "Grading" 🎨 tab in `ExplorerTools`)

**Verification**

The Explorer route was driven in headless Chrome over CDP against a plain dev server. Content
loading fails there because the Tauri host is absent — an expected, pre-existing limitation of
running the Explorer outside Tauri — but the panel itself mounts and works:

- The grading tab renders the toggle, three sliders, four channel tabs, and the curve editor
  with its dashed identity reference.
- A synthetic click at 40% across and 75% up the editor produced a control point at exactly
  `cx = 78.4, cy = 46.0` in view units, which is what the padded-viewBox mapping should yield.
  The pointer-to-curve mapping round-trips exactly.
- The resulting curve renders as a smooth monotone spline through the new point, with no
  overshoot past it.
- The copied fragment was spliced into `frontend-tuning.ts` and the whole gate re-run against
  it: `npm run check` clean and all 1340 tests passing with a tuned, `enabledByDefault: true`
  look shipped as the default.

**Decisions and Course Corrections**

- Dedicated panel rather than a World-panel section, mounted as a new tab in the existing
  `ExplorerTools` tab registry.
- Clipboard write via the browser API only; no Tauri command and no filesystem access, so a
  standalone published Explorer behaves identically. A failed write reports itself in the panel
  instead of silently looking like a successful copy.
- **The paste exercise found a brittle test, and it was mine.** `bakes identity parameters to
  an identity ramp` used `DEFAULT_COLOR_GRADE_PARAMETERS` as its identity input, so it failed
  the moment a real tuned look was pasted in — the exact scenario this feature exists to
  support. The test now builds an explicit `IDENTITY_PARAMETERS` constant. `accepts the shipped
  defaults` deliberately still reads the real default, because validating whatever look is
  currently shipped is a guard worth keeping.
- The curve editor's viewBox carries an 8-unit margin. Without it the first and last control
  points — the ones an author drags to lift blacks and clip whites — are drawn half outside the
  box and read as absent. `curvePoint` removes the margin so the mapping stays exact.
- The SVG needed its own `pointer-events: none` when the grade is off. A disabled `fieldset`
  disables form controls, so the sliders and buttons grey out, but an SVG is not a form control
  and stayed live — curves would have been editable while visibly disabled.
- `MAXIMUM_SATURATION` is exported so the panel's slider bound comes from the validator's
  ceiling rather than a duplicated literal that could drift past it.

### Phase 6: Cleanup and wrap-up

**Deliverables**

- Decide the depth-republish question from Phase 2 with evidence: if nothing draws to or
  reads the default framebuffer's depth after presentation in either path, delete
  `uSceneDepth`/`gl_FragDepth` from the presentation shader and the depth bind; otherwise
  document in-code why it stays.
- Same investigation for default-framebuffer stencil: after the restructure, audit whether
  the `stencil: true` context attribute, `#beginFrame`'s `STENCIL_BUFFER_BIT` clear, and
  `present()`'s stencil clearing serve any remaining consumer (the atlas executor disables
  stencil at the output, and no renderer path enables `STENCIL_TEST` against the default
  framebuffer). Delete what the audit proves dead; document what survives.
- Sweep vocabulary: no stray "LUT file", "HALD", or screenshot-command references anywhere;
  names say "color grade" consistently across shader uniforms, types, panel labels, and
  metrics.
- Re-run `npm run lint:dead` (knip) for orphaned exports introduced mid-plan.
- `npm run format`.
- Update this plan's decision logs; give the final tour.

**Acceptance Criteria**

- Full gate: `npm run check && npm run lint && npm run test:ts && npm run format:check`.
- One harness capture set with the shipped defaults (grade off) byte-matching Phase 2, and
  one with a sample grade enabled for the tour.

**Task Checklist**

- [x] Depth-republish decision + implementation
- [x] Stencil audit
- [x] Vocabulary sweep
- [x] Dead-export sweep
- [x] Final gate + captures

**Decisions and Course Corrections**

- **Depth republish deleted.** The audit found no consumer: nothing draws after presentation
  in either schedule, and no path reads default-framebuffer depth — the renderer's only
  `readPixels` is a texture-atlas preview through its own framebuffer, and Explorer selection
  goes through the entity tree rather than depth picking. `uSceneDepth`, its texture unit, its
  bind, and the `gl_FragDepth` write are gone; the grade strip moved to unit 1. Re-verified
  after removal: the blended fixture is still byte-identical to the Phase 2 baseline, and the
  portal interior sits at 0.058% against its 0.045% noise floor.
- **The depth *state* stays, and that distinction is load-bearing.** `gl.enable(gl.DEPTH_TEST)`
  runs once in the renderer's constructor, not per frame, so it is inherited global state.
  Disabling it in presentation — the tempting follow-on cleanup once nothing writes depth
  there — would leave every subsequent frame drawing with no depth test. The reason is now a
  comment on `present` so the next reader does not have to rediscover it.
- **Stencil is dead across the whole renderer, and was left alone deliberately.** Nothing
  anywhere enables `STENCIL_TEST`: every reference disables, clears, or saves/restores it. The
  present pass clears a stencil buffer no pass tests, `#beginFrame` clears it again, and the
  device still requests `stencil: true`. Removing only the presentation clear would be an
  incoherent half-cleanup, and removing all of it is a device-context change with a wider blast
  radius than a grading feature should carry. It predates this plan (added wholesale with the
  SAO pass, `ba8f49ff`, never with a consumer). **Reported as debt, not changed.**
- Vocabulary is consistently "color grade" across types, uniforms, panel labels, harness flag,
  and tuning. No "LUT file", "HALD", or screenshot-command vocabulary survives from the earlier
  external-tool design. The single "tone mapping" mention is the tuning comment explaining that
  retail has neither, which is the intended usage.

**Final gate**

`npm run check` (458 files, 0 errors), `npm run lint:ts`, `npm run lint:dead`, 1340 tests
across 174 files, and prettier over every touched file all pass.

## Risks & Mitigations

- **Portal composition into a non-default framebuffer misbehaves** (viewport, scissor, or
  backbuffer assumptions baked into the executor; stencil was ruled out in the dry run).
  *Mitigation*: Phase 2 ships alone with pixel-parity evidence; the executor fixture is the
  reference for supported targets; fix contracts in the pipeline, not call sites.
- **Blended pass depth semantics differ against the flat target's depth attachment** vs. the
  republished `gl_FragDepth` copy (precision differences could shift depth-test outcomes).
  *Mitigation*: the byte-compare set includes a blended-heavy scene; any z-fighting delta
  fails the phase.
- **Double or missing grade during A/B** if some path presents twice or skips presentation.
  *Mitigation*: after Phase 2 the presentation call is the single default-framebuffer write;
  Phase 4's garish-grade capture proves coverage, byte-parity proves absence when off.
- **Curve editor produces states the validator rejects** (coincident x during drag).
  *Mitigation*: editor ops enforce the same invariants the validator checks via a shared
  minimum-separation constant; the validator remains the loud backstop.
- **LUT precision introduces its own banding.** *Mitigation*: RGBA16F strip; dither is the
  only 8-bit quantization shaping step.
- **Clipboard unavailable in non-secure contexts.** *Mitigation*: harness/dev serve over
  localhost (secure); the button surfaces failure loudly.
- **Frame-cost regression from the extra portal-path present.** One fullscreen textured
  triangle; *mitigation*: profile comparison in Phase 2 acceptance rather than assumption.

## Definition of Done

- [x] Both render paths deliver every fragment through one presentation pass; grade covers
      opaque, portal, blended, and particle output identically.
- [x] Grade disabled is byte-identical to pre-plan output.
- [x] Explorer panel tunes white balance, saturation, and master/RGB monotone curves live,
      with A/B toggle.
- [x] Copy-to-clipboard emits a fragment that pastes into `EXPLORER_TUNING_OVERRIDES` and
      type-checks (verified by splicing a real fragment in and re-running the whole gate).
- [x] `EXPLORER_TUNING_OVERRIDES.colorGrade` documents the departure-from-retail rationale.
- [x] All gates pass: `npm run check`, `npm run lint`, `npm run test:ts`, and prettier over
      the files this plan touches (repo-wide `format:check` fails at HEAD for unrelated
      prettier-version reasons — see Phase 1's discovered debt).
- [x] Harness captures demonstrating parity and coverage shared in the final tour.

## Shipped Default

The plan shipped an identity, disabled grade so the feature could land without changing how the
client looks. An authored look has since been tuned in the Explorer panel and pasted into
`EXPLORER_TUNING_OVERRIDES.colorGrade`, which is exactly the workflow the export exists for, so
the grade now ships **enabled**: a gentle warm shift (temperature 0.03), a touch of saturation
(1.02), and a five-point master curve that lifts shadows slightly and softens the top end.

Two comments were reworded during the quality pass because that paste made them false. Both had
asserted `enabledByDefault: false` as a standing fact; they now describe the mechanism instead —
disabling the grade bypasses it rather than neutralizing it, so an off grade is bit-exact retail
presentation whatever the shipped look happens to be. A comment that names a tunable's current
value goes stale the first time someone tunes it.

## Outstanding Debt

Both items are pre-existing and were deliberately not folded into this feature:

1. **Prettier version drift.** The repo's committed formatting is prettier 3.8.x, but `^3.8.3`
   resolves to 3.9.6, which collapses short leading-pipe unions. `npm run format` rewrites ~36
   untouched files and repo-wide `format:check` fails at HEAD. Fix is a pin or a deliberate
   reformat commit — a repo-wide decision.
2. **Stencil is entirely vestigial.** No pass enables `STENCIL_TEST`, yet the device requests
   `stencil: true` and two paths clear the buffer every frame. Removing it coherently spans the
   device context; see the Phase 6 log.

## Open Questions

- Slider ranges for temperature/tint (perceptual unitless span vs. Kelvin-style labels) —
  decide in Phase 5 with the widget in hand; leaning symmetric unitless ranges around 0.
- Should the portal-path presentation reuse the flat target's depth republish at all, given
  the portal composite writes its own depth story? Folded into the Phase 6 depth decision
  (dry-run leaning: republish deletes entirely once nothing consumes default-framebuffer
  depth).
