# Holtburger 3D Portal-Space Loading and Transition Plan

Status: **Implementation, cleanup, and automated verification complete (2026-09-01); representative
live destination coverage remains retained external validation debt.** The runtime consumes one
exhaustive controller-owned plan, resolves renderer resources without nullable composition inputs,
and acknowledges separately rendered receipts. Browser evidence proves that controller-produced
exit progress materially changes GPU pixels through the production fullscreen presenter. Iterative
live review corrected authority-grace ordering, the activation-settled camera wire path,
exit-frame stability, tunnel looping, and the reversible warp look. A deliberate outdoor/indoor
destination matrix and five-sample cold timing study remain useful follow-up evidence, not unfinished
implementation phases.

Origin: client-mode initial entry and teleport previously preserved the last world frame while the
destination loaded, showed the authored portal tunnel only after destination presentation
converged, and began normal boom-camera solving only after portal space was dismissed.

## Context and Boundaries

### Goal

Make portal space an immediate, indefinite loading presentation that enters from an optional origin
snapshot, remains visible until the destination and boom camera have converged, and exits through a
retail-inspired but deliberately modern screen-space transition into a clean destination frame.

### Why this cutover is deserved

`ClientPresentationSession.frame()` currently publishes portal-transition state while destination
activation is pending, then returns before `GamePresentationRuntime.render()`. The browser therefore
keeps displaying the last completed canvas frame. The renderer's tunnel pass runs only as part of a
normal world frame and requires a committed primary view, so it cannot act as a loading screen during
the period when it is most needed.

The destination camera has a second, independent ordering defect. During world activation,
`holtburger-core` permits one collision-backed camera seed but suppresses ordinary boom advancement
until activation completes and `ClientState::InWorld` becomes active. The frontend treats that
stationary seed (or a fallback at zero reach) as sufficient to begin the portal exit. The reveal
acknowledgement then completes activation, and only the subsequent in-world ticks extend the camera
to its third-person placement. The observed post-portal boom movement is therefore the expected
result of the current contracts, not a renderer timing fluctuation.

This plan replaces those contracts cleanly. It does not add a loading overlay beside the existing
transition or special-case a few early returns. Portal presentation becomes independently renderable,
and a bounded authority-owned camera settle transaction becomes a readiness fact consumed by the
existing reveal barrier.

### In scope

- Start portal presentation on the first renderable `portal-space` lifecycle frame, before player
  identity, destination interest, dynamic realization, EnvCell scope, or destination camera output
  is available.
- Preserve the most recent completed origin scene as an optional renderer-owned snapshot for
  teleport entry; initial world entry explicitly has no origin snapshot.
- Give the authored portal tunnel a transition-only render path that does not require a committed
  world view, destination scene, dynamic player, viewer light, particles, or gameplay camera.
- Add an authored-tunnel axial rotation inspired by retail's continuously changing portal camera
  direction.
- Replace the current linear snapshot/destination blend with restrained screen-space entry and exit
  warps that are visually reminiscent of retail's world-collapse/world-expansion transition.
- Keep portal space visible indefinitely until exact destination static residency, local-player
  realization, required render scope, and boom-camera convergence are all current for the same world
  generation.
- Settle the collision-backed boom camera in one bounded activation-time operation without enabling
  movement, gameplay input, simulation authority, or `InWorld` lifecycle behavior.
- Add one core-owned camera convergence fact; frontend and validators consume it and never rederive
  convergence from reach values or path geometry.
- Preserve the existing one-shot pure-destination-frame acknowledgement and generation supersession
  guarantees.
- Add focused unit, renderer, browser-harness, and live-client verification for initial entry,
  teleport, delayed loading, camera convergence, and superseded transitions.
- Remove the obsolete simple-blend vocabulary, boolean capture ambiguity, and tests that encode
  zero-reach camera output as reveal-ready.

### Out of scope

- Exact reproduction of retail's view-distance override, scene clipping, random-number sequence, or
  one-second timing constants.
- Changes to ACE protocol messages, server teleport semantics, world-generation ownership, or the
  meaning of `LoginComplete`.
- Enabling character controls, movement simulation, precise jump, ambient world audio, or other
  in-world systems while portal activation remains active.
- Moving app-local transition timing, distortion strength, or tunnel composition policy into shared
  Rust crates.
- Changing ordinary indoor portal visibility/rendering; this plan concerns the full-screen
  teleport/loading presentation, not EnvCell aperture traversal.
- Adding a general post-processing graph, generic loading-screen framework, motion blur, bloom,
  chromatic aberration, film grain, or unrelated presentation effects.
- Modifying the retail client decompile.
- Retaining production-only timing probes or route-specific debug UI after verification.

## Ground Truth

### Retail behavior

- `acclient-eor-source/acclient.h:3369-3378` defines the retail phase sequence:
  `WORLD_FADE_OUT`, `TUNNEL_FADE_IN`, `TUNNEL`, `TUNNEL_CONTINUE`, `TUNNEL_FADE_OUT`, and
  `WORLD_FADE_IN`.
- `acclient-eor-source/acclient.c:251982-252003` begins the requested phase, snapshots the normal
  view-distance value, resets tunnel rotation interpolation, and plays the enter-portal sound.
- `acclient-eor-source/acclient.c:252638-252678` switches from the world viewport to the authored
  portal-space viewport and starts the portal animation at 40 authored frames per second.
- `acclient-eor-source/acclient.c:252679-252717` eases between random axial direction targets. Each
  target is selected from 0-360 degrees and held for a random 0.6-1.8-second interpolation span.
- `acclient-eor-source/acclient.c:252720-252752` eases the world view distance between its normal
  value and `0.001` over one second on entry and exit. This is the strongest decompile evidence for
  the remembered world-collapse/world-expansion effect; it is not evidence of a retail screen-space
  UV shader.
- `acclient-eor-source/acclient.c:252754-252790` keeps the tunnel active after loading ends, aligns
  tunnel exit with its authored animation when practical, hides the tunnel, restores the world
  viewport, and plays the exit-portal sound.
- `acclient-eor-source/acclient.c:252792-252800` completes the world fade-in before sending the login
  completion notification.
- `acclient-eor-source/acclient.c:272970-273007` builds and samples the easing table used by the
  phase and rotation interpolation.

The new screen-space warp is deliberately reminiscent rather than exact. Its implementation must
carry a `RETAIL DIVERGENCE:` comment citing `acclient.c:252720-252752`, explaining that restoring the
retail view-distance collapse would exchange a bounded full-screen presentation effect for scene
visibility/clipping churn, and recording the blast radius: every client portal exit, every teleport
entry with a captured origin, and no initial-entry origin branch. The tunnel rotation should cite
`acclient.c:252679-252717` as matched behavior without claiming the same random sequence.

### Current frontend and renderer contracts

- `apps/holtburger-3d/src/client/client-presentation-session.ts`
  - `frame()` starts portal state only after local-player identity and valid world placement exist.
  - activation, realization, origin/scope, and camera waits return `rendered: false` before
    `runtime.render()`.
  - `#ensurePortalTransition()` derives capture eligibility from teleport cause and prior completed
    rendering.
  - `#publishPortalTransition()` advances state but cannot cause pixels to be presented by itself.
  - any non-null current-generation camera presentation makes `activationReady` true.
- `apps/holtburger-3d/src/lib/client/portal-transition-controller.ts`
  - `entering` is an instantaneous bookkeeping edge; only `exiting` has timed progress.
  - readiness is one undifferentiated boolean and has no camera-convergence meaning.
  - waiting correctly has no timeout and reveal remains a one-shot destination-frame receipt.
- `apps/holtburger-3d/src/lib/game/runtime/game-presentation-runtime.ts`
  - `render()` fails loudly without a committed primary view.
  - portal animation advances only inside a normal world render.
  - the runtime already owns portal animation cadence and authored sound hooks.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-renderer.ts`
  - `#prepareTransitionSnapshot()` captures the last completed flat scene target at frame entry.
  - `#drawPortalTransitionTunnel()` currently consumes a prepared world view and derives its virtual
    portal room from the current camera transform.
  - `#transitionPresentationInput()` supplies the outgoing snapshot, current scene, tunnel target,
    and simple opacity/progress values to the final compositor.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-flat-scene-presentation.ts`
  - the fullscreen presentation shader currently performs only a normalized outgoing/current blend
    followed by tunnel alpha composition.
  - this is the correct single stage for a bounded whole-frame warp; no material or scene pass needs
    transition-specific distortion.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-transition-snapshot.ts`
  - the snapshot already owns explicit generation allocation, capture, diagnostic accounting, and
    destruction.
- `apps/holtburger-3d/src/client/client-tuning.ts`
  - app-local camera and scene-interest policy already lives here; transition durations and visual
    strengths belong beside those settings rather than in renderer literals.

### Current core camera and activation contracts

- `crates/holtburger-core/src/client/mod.rs:307-427`
  - world activation waits for destination, collision body, containment, scene readiness, one camera
    seed, and external reveal acknowledgement.
  - `camera_seed_ready` means that a seed was emitted, not that the boom reached a stable view.
- `crates/holtburger-core/src/client/runtime.rs:241-368`
  - `active_world` simultaneously gates gameplay simulation, dynamic path batching, and camera
    advancement.
  - because activation remains present until reveal, ordinary camera advancement cannot occur while
    portal space is visible.
- `crates/holtburger-core/src/client/camera.rs:608-629`
  - `seed()` performs one normal collision transaction with a one-millisecond duration and is
    intentionally the only pre-reveal camera output.
- `crates/holtburger-core/src/kinematic_boom.rs:600-710`
  - the controller owns desired reach, collision-proven rendered reach, clearance revision, filtered
    pivot, and placement state.
- `crates/holtburger-core/src/kinematic_boom.rs:1225-1323`
  - clearance recovery and vertical-pivot filtering converge over time and may legitimately leave
    `rendered_reach` below `desired_reach` when geometry constrains the camera.
  - only this controller has enough information to decide that its visual placement has converged;
    equality of the two public reach fields is not a valid frontend rule.
- `apps/holtburger-3d/src/lib/game/camera/client-camera-session.ts`
  - current camera status reports registration, playback, proof, reach, and placement outcome but no
    convergence fact.

### Existing verification surfaces

- `apps/holtburger-3d/src/client/client-presentation-session.test.ts` covers generation replacement,
  destination realization, camera absence/wrong generations, fallback reveal, and reveal receipts.
- `apps/holtburger-3d/src/lib/client/portal-transition-controller.test.ts` covers indefinite waiting,
  exit timing, capture suppression on supersession, sound edges, and one-shot reveal.
- `apps/holtburger-3d/src/lib/game/renderer/webgl2-transition-snapshot.test.ts` covers transition
  resource lifecycle.
- `apps/holtburger-3d/src/harness/browser/BrowserHarnessApp.svelte` already exposes a synthetic
  portal-transition demo and runtime diagnostics.
- `apps/holtburger-3d/scripts/browser-harness.mjs` is the canonical browser/WebGL verification path.
- `apps/holtburger-3d/scripts/live-client-ui-probe.mjs` can drive the actual Electron client, capture
  lifecycle/camera/renderer evidence, and teleport without running the interactive TUI.

## North Stars

1. Portal space is a loading presentation, so it must be most reliable while the world is least
   available.
2. Transition pixels depend on canvas extent and prepared transition assets, never on destination
   authority or a gameplay camera.
3. The destination is revealed only when the scene and the camera are both ready to be seen.
4. Controls remain withdrawn throughout portal space; the hidden destination camera settles as one
   bounded activation prerequisite rather than entering ordinary simulation.
5. One full-screen compositor owns entry and exit distortion; world materials remain unaware of
   teleport presentation.
6. Initial entry and teleport share one state machine. A timed entry presentation exists only when
   a valid origin snapshot exists; initial entry begins directly in the tunnel.
7. Retail supplies timing and motion evidence, not an architectural template. Reproduce the useful
   authored character while replacing 1999 view-distance manipulation with a bounded modern effect.
8. Visual interest comes from coherent motion, authored tunnel animation, and a decisive warp;
   avoid stacking unrelated effects.
9. Transition resources are generation-owned, bounded, and released immediately after the first
   clean destination frame.
10. Every frame has one exhaustive presentation instruction produced once by the transition owner;
    renderers execute it without reconstructing intent from phases, nullable textures, or resource
    side effects.

## Settled Direction Decisions

### D1. Use one four-phase presentation state machine

The clean target state is:

1. `entering`: optional origin snapshot contracts and twists into the tunnel;
2. `waiting`: tunnel is fully present and advances indefinitely;
3. `exiting`: a fully ready destination warps into its neutral presentation while the tunnel leaves;
4. `revealed-awaiting-handoff`: one clean destination frame is presented and acknowledged.

Both `entering` and `exiting` have explicit monotonic progress and app-local durations when their
source images exist. Origin-absent initial entry starts directly in `waiting`; it never animates a
synthetic black source. If readiness arrives during an origin-present entry, it is retained and
consumed after entry reaches waiting; at least one waiting/tunnel frame must be presented before
exit begins. Waiting has no timeout or synthetic success fallback.

Do not add separate `initial-entry` and `teleport` state machines. The origin source is the only
meaningful distinction.

### D2. Replace boolean origin availability with an explicit source choice

Replace `outgoingAvailable`/`outgoingCaptured` vocabulary with a source choice such as:

- `origin: { kind: "capture-last-world" }`; or
- `origin: { kind: "absent" }`.

The renderer still owns the texture and reports whether capture actually exists. Initial entry uses
`absent`. A fresh teleport after a completed world frame requests `capture-last-world`. A transition
superseded while portal space is already active uses `absent` and never captures the tunnel as a new
origin.

The exact type name may change during implementation, but it must remain a discriminated choice,
not a boolean paired with phase-dependent interpretation.

### D3. Add a transition-only render entry point, not a synthetic world camera

`GamePresentationRuntime` and the renderer gain a narrow way to advance and present portal
transition frames with only time, extent, transition state, and prepared transition resources.
This path:

- advances authored tunnel animation and hooks;
- captures the previous completed world target only when requested;
- renders the portal visual into its owned tunnel target using a fixed virtual room/camera;
- presents origin/tunnel composition to the default framebuffer; and
- does not advance scene animation, particles, ambient audio, dynamic presentation, world selection,
  or normal renderer feedback.

Do not manufacture a fake `PrimaryCameraView`, anchor landblock, viewer light, destination
environment, or empty world frame to satisfy `render()`. That would turn absence into dishonest
world state and keep the current coupling alive under new names.

When the destination becomes presentable, ordinary world rendering resumes behind the same
full-screen transition compositor for the exit. The transition-only and ordinary frame paths share
the tunnel-target and final-presentation helpers; they are not two visual implementations.

### D4. Keep tunnel rotation private to the portal virtual camera

The retail-inspired axial angle affects only the portal-space virtual camera or equivalent tunnel
model transform. It never mutates the gameplay boom, primary view, world camera history, camera
residency, or reveal convergence.

Use deterministic generation-keyed angle targets and deterministic segment durations in the retail
ranges rather than ambient `Math.random()`. This preserves the wandering retail character while
making tests, recorded screenshots, and supersession reproducible. Smooth interpolation uses one
documented easing function shared with the transition progress policy where practical.

### D5. Use one reversible warp-drive transition

The final presentation shader receives one transition sample contract sufficient to distinguish
origin entry from destination exit and a normalized progress value. Both edges use the same
aspect-correct radial zoom-history transform. Entry accelerates the captured origin from rest into
the tunnel; exit evaluates the identical transform backward so the destination resolves out of the
tunnel. A continuous radial weight leaves the exact vanishing point spatially stable without
creating a protected disc or visible aperture boundary. The whole source moves coherently while
bright image features contribute additive history streaks, and a cubic opacity envelope preserves
exact source/tunnel endpoints.

Avoid chromatic separation, temporal accumulation, separate blur passes, noise textures, or extra
render targets. Twelve fixed fullscreen history samples run only during each one-second transition
edge; the existing origin snapshot, current scene target, and tunnel target remain sufficient.

### D6. Settle the hidden boom in one bounded activation operation

Do not split ordinary fixed-tick simulation merely to animate a camera nobody can see. Once the
activation's collision body and destination scene are ready, core runs the normal boom controller
through a bounded sequence of fixed-duration convergence steps against one stationary/current target
sample. The operation stops when the controller reports settlement or its hard iteration/work bound
is exhausted.

The loop is accelerated in wall-clock terms, not mathematically special: every step uses the normal
clearance, collision, portal transit, reach recovery, and pivot-filter logic. It does not consume
frontend intent, advance the authority clock, run player simulation, emit intermediate camera paths,
or send ACE gameplay actions. Because portal space hides the destination, preserving the boom's
comfort interpolation in real time has no consumer.

Replace `camera_seed_ready` with an honestly named settled-camera readiness fact. On success, emit
one generation-current stationary camera presentation at the final settled endpoint so the frontend
cannot replay the internal convergence motion after portal exit. Keep `active_world` unchanged for
ordinary movement, dynamic path batching, feedback, and camera advancement after handoff.

### D7. Core owns and publishes the settlement result

Add one named settlement result to the camera outcome/tick contract, for example a two-state
`converging | settled` value. `KinematicBoomController` computes it from the same committed target,
clearance, pivot-filter, and movement transaction that authored the output. The activation settle
operation is its first consumer; the frontend consumes the final result without rederiving it.

The exact tolerance and hard work bound are implementation policy proven through focused controller
tests. They are not live-data discovery prerequisites and must not depend on browser frame rate or
wall-clock timeout.

Required distinguishing scenarios:

- the initial collision-proven seed is `converging` even though it is a valid render placement;
- an unobstructed camera becomes `settled` near its requested reach;
- an obstruction-limited camera becomes `settled` below desired reach;
- a clearance/pivot change returns a previously settled camera to `converging`; and
- fallback/held output does not silently claim settlement without a controller-owned proof.

The frontend must not derive this fact from `desiredReach`, `renderedReach`, path endpoints,
sequence count, elapsed wall time, or placement-outcome kind. If a field lacks a scenario where it
differs from existing fields, do not add it.

### D8. Reveal readiness is one generation-current conjunction

The frontend begins exit only when all of these belong to the current world generation:

- scene activation status is ready;
- required local-player presentation realization is installed;
- the local player's resolved destination origin and required EnvCell scope are present;
- a current camera presentation exists with the projection needed for the destination frame; and
- core reports the boom camera settled.

Compute this conjunction once in the presentation session and pass the result to the transition
controller. Do not scatter repeated readiness clauses among early returns. The first destination
frame rendered behind a still-opaque tunnel does not acknowledge reveal; acknowledgement remains
reserved for the first completely unwarped, tunnel-free destination frame.

### D9. Preserve the existing retail completion grace as authority policy

The core's proven completion grace for broken shipped destinations remains in force. This plan does
not turn visual convergence into an authority deadlock: core may publish `InWorld` and send its
protocol completion while the generation-current presentation barrier remains in portal space.
Authority lifecycle and presentation lifecycle are deliberately separate clocks. The controller,
scene activation, and late realization work remain current by the retained world generation until a
neutral destination frame is acknowledged or a newer generation supersedes them.

Do not map authority grace to visual readiness or failure. Explicit scene-activation failures still
clear to black, release transition resources, and raise the existing presentation error UI. Core
camera/body exhaustion needs its own typed terminal projection before the frontend may treat it as
failure; the broad `InWorld` edge is insufficient evidence.

### D10. Replace phase transport with one exhaustive presentation plan

The state machine may retain lifecycle-oriented states internally, but no downstream layer receives
a generic phase and reinterprets it. `PortalTransitionController` produces one complete app-local
presentation instruction per frame:

- `tunnel-only` — render the authored tunnel with no origin or destination sampling;
- `origin-to-tunnel` — composite one required captured origin into the tunnel at explicit progress
  through the forward warp-drive transform;
- `tunnel-to-destination` — composite the required current destination out of the tunnel at explicit
  progress through the reverse warp-drive transform; or
- `destination-only-awaiting-handoff` — render a neutral, tunnel-free destination and wait for its
  generation-matched presentation receipt.

Names may tighten during implementation, but the union must preserve these invariants. No variant
contains an optional texture whose absence changes its meaning. Initial entry cannot produce
`origin-to-tunnel`. Only complete destination readiness can produce `tunnel-to-destination`.
`destination-only-awaiting-handoff` is the only variant eligible for reveal acknowledgement.

Advancement happens exactly once before rendering. The post-render operation accepts renderer
feedback and may acknowledge a presented destination, but it does not sample time or advance the
state machine again. Client and Explorer consume the same controller output; delete their duplicate
phase-to-frame adapters.

`GamePresentationRuntime` may enrich tunnel-bearing variants with one composite authored-visual
sample containing animation and axial-roll cursors. It must preserve the presentation variant,
generation, and progress byte-for-byte. The renderer then resolves required owned
resources into a second exhaustive compositor input:

- `scene-only`;
- `tunnel-only { tunnel }`;
- `origin-to-tunnel { origin, tunnel, progress }`; or
- `tunnel-to-destination { tunnel, destination, progress }`.

Missing resources for a selected variant are invariant failures, not signals to choose a different
effect. Delete `worldEffect`, nullable `outgoingScene`, inferred `tunnelOpacity`, renderer-side
`portalTransitionProgress()`, and every branch that reconstructs composition from lifecycle phase.
The desired production change is net-neutral or negative in lines: new exhaustive types and one
pure resolver replace duplicate adapters and inference branches; most added volume belongs in tests.

## Phased Implementation

### Phase 0: Freeze the causal regressions and visual baselines

#### Deliverables

- Extend `client-presentation-session.test.ts` with controlled pending activation, player
  realization, scope, and camera settlement.
- Extend `portal-transition-controller.test.ts` with timed entry, indefinite waiting, early-ready
  latching, supersession, and clean-frame acknowledgement cases.
- Add a focused Rust test demonstrating that the current activation emits only the seed and that
  normal camera advancement starts only after reveal.
- Extend the browser harness portal demo so it can hold readiness, select origin-present versus
  origin-absent, and expose phase/progress/frame counters.
- Capture baseline screenshots/video-frame sequences for current teleport entry, portal waiting,
  and exit. Record the exact harness arguments beside the artifacts or in this plan during
  execution; do not check temporary captures into the repository.

#### Task checklist

- [x] Prove a pending portal activation publishes transition state but calls no render entry point.
- [x] Prove missing/wrong-generation camera output leaves the canvas unrendered.
- [x] Prove the seed currently satisfies frontend activation readiness.
- [x] Prove core suppresses ordinary boom advancement until external reveal completes activation.
- [x] Add deterministic harness controls for readiness and origin presence.
- [x] Close the missed simple-blend/non-rotating image baseline as an explicit waiver; retain the
      causal pre-cutover tests rather than reconstructing a deleted implementation.

#### Acceptance criteria

- Focused tests fail against the current implementation for the demonstrated reasons, not because
  of timers or missing external assets.
- The browser harness can hold portal space longer than the entry/exit durations and report whether
  frames continue to present.
- No production diagnostics are added in this phase.

#### Decisions and course corrections

- Pre-change focused tests and the traced call graph confirmed that transition publication occurred
  before early returns while `render()` remained coupled to a committed primary view.
- The former seed/readiness behavior was removed rather than retained as a compatibility path.
- Deterministic harness controls now select phase, progress, and origin presence. A pre-cutover
  simple-blend screenshot was not captured before implementation began; the causal baseline is
  retained in focused tests, but that missed artifact cannot honestly be reconstructed without
  reverting the cutover.

### Phase 1: Cut over the pure transition lifecycle and source vocabulary

#### Deliverables

- Refactor `portal-transition-controller.ts` to the four explicit phases with timed entry and exit.
- Replace origin capture booleans with the explicit origin source choice.
- Add app-local transition timing and visual policy to `client-tuning.ts`; validate every finite
  range through reachable tests.
- Update `PortalTransitionFrame` and related diagnostics to carry only the renderer inputs needed by
  the current phase.
- Delete obsolete aliases, comments, and tests using `outgoingAvailable`, `outgoingCaptured`, or
  instantaneous-entry semantics.

#### Task checklist

- [x] Define phase-specific state shapes so invalid progress/source combinations are unrepresentable.
- [x] Make readiness arriving during entry latch without skipping entry.
- [x] Guarantee at least one fully entered waiting frame before exit.
- [x] Preserve indefinite waiting and one-shot reveal.
- [x] Preserve generation supersession without capturing portal pixels.
- [x] Keep mode-specific durations in each app's portal-transition tuning, centralize the shared
      warp-drive look in frontend tuning, and inject it through device and renderer construction.

#### Acceptance criteria

- Pure controller tests cover every state edge and all configuration validation failures.
- Each state field has a named controller, runtime, renderer, diagnostic, or test consumer.
- No compatibility shim retains the old boolean vocabulary.
- Type checking and focused TypeScript tests pass.

#### Decisions and course corrections

- Entry and exit use independent 1,000 ms app-local durations. Visual strength remains composition
  policy because the controller has no visual consumer.
- Origin capture is the discriminated `capture-last-world | absent` source choice. Supersession
  forces `absent`, so portal pixels cannot become an origin snapshot.
- Entry is now structurally conditional on `capture-last-world`. An absent origin begins directly
  in `waiting`; it cannot spend the entry duration transforming a synthetic black source.
- Focused controller tests and complete TypeScript checking pass with no old outgoing-availability
  vocabulary in production code.

### Phase 2: Make portal space independently renderable

#### Deliverables

- Add the narrow transition-only presentation entry point to the client runtime interface and
  `GamePresentationRuntime`.
- Refactor WebGL2 tunnel drawing to use a stable virtual portal-room camera independent of
  `PreparedView` and world anchors.
- Share portal animation advancement, tunnel target drawing, final composition, and resource
  retirement between transition-only and ordinary destination frames.
- Reorder `ClientPresentationSession.frame()` so portal begin/presentation occurs before player and
  destination gates; loading states still update diagnostics but no longer suppress portal frames.
- Capture the last completed origin world target exactly once for eligible teleports; initial entry
  presents correctly with no origin texture.
- Extend renderer diagnostics to distinguish transition-only presented frames, origin capture
  presence, tunnel target activity, and generation without adding frame-hot Svelte state.

#### Task checklist

- [x] Render entry and waiting frames with no local-player identity.
- [x] Render entry and waiting frames with no scene activation receipt.
- [x] Render entry and waiting frames with no committed primary world view.
- [x] Ensure transition-only frames do not advance world animation, particles, ambience, or
      dynamic presentation.
- [x] Preserve one prior world snapshot across the transition generation and release it after exit.
- [x] Prove initial entry allocates no origin snapshot.
- [x] Prove resize samples an old-sized origin by normalized UV without reallocating it.
- [x] Prove supersession retires old-generation resources and never snapshots the tunnel.

#### Acceptance criteria

- A synthetically delayed destination presents animated portal-space frames continuously for the
  full delay.
- Initial entry and teleport share the same tunnel implementation and differ only in origin source.
- Renderer resource diagnostics return to baseline after handoff and teardown.
- `npm run test:ts`, `npm run check`, and touched-file formatting/lint pass.
- Browser harness screenshots show portal space before destination readiness.

#### Decisions and course corrections

- Added a transition-only renderer input containing only extent, frame settings, time, and portal
  state. It cannot carry a world view, environment, entities, particles, or audio state.
- Loading polling drains installation artifacts without advancing dynamic placement. Ordinary
  tick/render resumes only once the complete destination is eligible to exit.
- The tunnel uses a stable virtual camera outside world authority. Ordinary exit and transition-only
  frames share tunnel drawing, final composition, and resource cleanup.
- Missing and stale camera outputs continuously report rendered portal frames in focused client
  tests. Browser diagnostics prove one 3,686,400-byte origin snapshot at 1280x720 for eligible
  entry and zero snapshot bytes for origin-absent waiting. The renderer retains the first native
  snapshot across resize and samples normalized UVs.
- The real-renderer initial-entry sample begins directly at `tunnel-only`, submits 42 authored
  tunnel draws, and reports zero origin bytes and zero snapshot allocations. The later eligible
  teleport allocates exactly one origin generation.
- A real-renderer lifecycle fixture superseded generation 101 midway through origin entry.
  Generation 102 began as `tunnel-only`, disposed the 3,686,400-byte origin allocation, retained
  zero snapshot bytes, and did not capture portal pixels as a replacement origin.

### Resteer checkpoint: Audit the new rendering seam

Before adding visual effects or changing core camera cadence:

- Review whether transition-only presentation is genuinely independent or merely hides a synthetic
  world view behind an adapter.
- Confirm ordinary render behavior and profiling are unchanged while no transition is active.
- Inspect resource counters across initial entry, teleport, supersession, resize, and teardown.
- Dry-run Phases 3-5 against the implemented types; collapse any field that would otherwise be
  rederived in multiple layers.
- Reassess whether one compositor contract still serves origin entry, tunnel waiting, and
  destination exit without phase-dependent nullable-field soup.
- Record discovered debt and adjust later phase boundaries before proceeding.

### Phase 3: Add retail-inspired rotation and bidirectional warp

#### Deliverables

- Add deterministic generation-keyed tunnel angle interpolation in the runtime or renderer owner
  that already advances portal animation.
- Apply the angle only to the virtual portal camera/model transform.
- Extend the final presentation shader with one bounded, reversible warp-drive transform.
- Add the required `RETAIL DIVERGENCE:` comment for screen-space warping and precise retail citations
  for tunnel rotation.
- Add pure tests for deterministic angle targets/durations, plus GPU assertions for exact temporal
  reversal, a stable vanishing point, peripheral motion, exact endpoints, and edge clamping.
- Extend the browser harness to freeze transition progress and generation so entry, waiting, and
  exit frames can be inspected independently.

#### Task checklist

- [x] Confirm the same generation and time samples produce identical tunnel angles.
- [x] Confirm generation supersession resets rotation without a visible NaN/discontinuity frame.
- [x] Confirm world camera diagnostics remain unchanged while tunnel rotation advances.
- [x] Confirm warp is neutral outside transitions and exactly neutral at the clean destination edge.
- [x] Tune entry and exit as opposite time directions through one shader path behind the same
      exhaustive compositor contract.
- [x] Record the observable blast-radius census in the retail-divergence comment.

#### Acceptance criteria

- Waiting portal space visibly rotates with smooth changes rather than a fixed view or frame-rate
  dependent stepping.
- Origin-present entry visibly pulls the final origin frame into portal space.
- Origin-absent entry contains no invalid texture sampling, black-frame flash, or synthetic origin.
- Destination exit visibly expands/settles into a pixel-neutral final frame.
- No new render targets, per-frame allocations, or transition branches affect ordinary frames.
- GPU/browser captures show no edge seams or sampling outside the texture.

#### Decisions and course corrections

- Axial targets are generation-keyed and deterministic; segment durations cycle through retail's
  0.6, 1.2, and 1.8 second range with smoothstep interpolation and shortest-angle travel.
- Human review rejected the first -0.08/+0.08 radial sampler as barely visible, the shared pinch as
  the wrong character, and the shrinking protected aperture as cheesy. The replacement is one
  reversible zoom-history transform: entry evaluates acceleration at `progress`, while exit uses
  `1 - progress`. Twelve source-history samples smear bright structure radially, a continuous
  center weight avoids a hard ring, and cubic opacity exposes the tunnel at the exact endpoint.
  Initial entry still bypasses this branch because it has no origin.
- Human review accepted the reversible warp-drive direction and requested room for a more dramatic
  pass. Maximum zoom, acceleration bias, streak intensity, world-opacity exponent, and the paired
  radial-smear bounds now have one edit point at `SHARED_FRONTEND_TUNING.portalTransition.visual`.
  Client and Explorer reference that same object from their app-local portal-transition tuning, and
  each composition root injects it through device and renderer construction. The renderer validates
  and uploads it once with the resident presentation program and owns no production fallback. Fixed
  history count and luminance selection remain implementation details because they do not yet have
  independent tuning scenarios.
- The portal is a DAT-authored setup (`0x02000306`) driven by a DAT-authored 120-frame animation
  (`0x030005ac`) at 40 fps. Only the virtual-camera roll and fullscreen transition are procedural.
  Retail starts that sequence at frame 1 (`acclient.c:252663-252668`); the former 0-119 window
  incorrectly revisited the special first frame every three-second lap. Both runtime traversal and
  renderer sampling now use the retail 1-119 window.
- The first corrected seam capture proved a second coupling: procedural axial roll was driven by
  the authored clip cursor and therefore also reset at every lap. Roll now uses a separate monotonic
  generation-local frame clock, matching retail's independent rotation timing.
- The real-renderer supersession fixture advanced generation 101 roll to 1.652 authored-frame
  units, then observed generation 102 at animation frame 1 and axial roll 0 on its first presented
  tunnel frame. The following resized waiting frame advanced both clocks with finite values.
- A one-second pose blend from the authored tail back to frame 1 was rejected in live review: even
  though it made the seam mathematically continuous, it visibly reversed the tunnel and therefore
  behaved like ping-pong playback. The special sampler, catalog tuning field, tests, and
  `RETAIL DIVERGENCE` were deleted. Portal space now uses ordinary literal cyclic sampling over the
  corrected retail 1-119 window; only the independent axial roll continues across the lap.
- The first exit compositor squared an already-eased reveal scale. That left the destination
  pinhead-small for most of the one-second exit, making the final growth read as an abrupt cut. The
  exit mapping now applies smoothstep once, keeping the destination legible through the middle while
  preserving neutral endpoints.
- The gradient GPU fixture samples the horizontal centerline at entry progress 0.25 and compares its
  entire framebuffer byte-for-byte with exit progress 0.75. It requires the center texel to change
  only by the shared opacity envelope while both peripheral samples prove radial motion;
  solid-color entry/exit censuses continue proving exact origin/tunnel endpoints. The authored
  1280x720 midpoint capture shows coherent radial history streaks without an aperture seam, but
  pacing and comfort remain live-review questions.
- The `RETAIL DIVERGENCE` comment cites `acclient.c:252720-252752` and scopes the blast radius to the
  fullscreen pass plus optional origin and destination textures. Midpoint entry/exit captures show
  the intended radial motion, but visual acceptance remains open.

### Phase 4: Settle and classify the boom during activation

#### Deliverables

- Replace the activation's one-shot `seed_camera()` path with a bounded camera settle operation that
  runs after the existing body/destination-scene prerequisites.
- Add controller-owned convergence classification to `KinematicBoomOutcome`, projected once into
  `ClientCameraTick` and the TypeScript host contract.
- Emit only the final stationary settled camera presentation; keep intermediate convergence steps
  internal to core.
- Update Rust serialization, TypeScript decoding, camera-session status, fake transports, and tests
  atomically; retain no nullable or inferred compatibility path.
- Add focused tests for unobstructed, obstruction-limited, pivot-filtering, clearance-change,
  held/fallback, stale-generation, bounded-work exhaustion, and activation-time settlement cases.

#### Task checklist

- [x] Identify and name the controller-local convergence error(s) already computed during a solve.
- [x] Choose profile-owned tolerances and a hard iteration/work bound; neither may depend on
      presentation frame rate or wall time.
- [x] Demonstrate a settled obstruction-limited camera with `renderedReach < desiredReach`.
- [x] Demonstrate the initial controller step is presentable but not settled.
- [x] Settle the camera during portal activation with a stationary target and no accepted player
      input.
- [x] Prove intermediate convergence paths are not emitted and the final published path is
      stationary at the settled endpoint.
- [x] Prove work-bound exhaustion returns a named unsettled result instead of spinning or claiming
      readiness.
- [x] Confirm no movement, jump, network action, or `InWorld` event is enabled early.
- [x] Confirm a stale camera generation cannot satisfy current activation convergence.

#### Acceptance criteria

- Core tests prove the bounded settle operation reaches both unobstructed and obstruction-limited
  endpoints before external reveal.
- Client transport tests prove convergence survives serialization/decoding without frontend
  rederivation.
- Movement and control tests prove portal activation still withdraws gameplay authority.
- The settle operation has a deterministic hard work bound and emits no intermediate playback.
- Rust formatting, focused tests, and clippy with warnings denied pass.

#### Decisions and course corrections

- `KinematicBoomConvergence` is computed from camera displacement, filtered-pivot movement, and
  raw-to-filtered pivot error while requiring requested clearance to be committed. It does not infer
  settlement from reach, so obstruction-limited endpoints remain representable.
- Standard tolerances are 0.001 world units for camera and pivot error. Activation performs at most
  256 ordinary 16 ms stationary controller steps synchronously.
- Intermediate ticks remain internal. Success publishes one generation-current stationary path;
  exhaustion becomes a named activation state and waits for the existing completion grace.
- The old `seed_camera` mechanism was deleted. The complete `holtburger-core` suite passes 322
  tests, including initial-presentable-but-converging, unobstructed settlement, and
  obstruction-limited settlement below desired reach.

### Phase 5: Gate exit on complete destination presentation

#### Deliverables

- Reshape `PortalSceneActivation` or a colocated composite readiness type so scene, player, scope,
  camera presentation, and camera convergence currentness are evaluated once.
- Start destination rendering behind the opaque tunnel only after the destination view is complete.
- Begin `exiting` only from the complete generation-current readiness conjunction.
- Keep audio-listener/gameplay input handoff aligned with `InWorld`, not merely with destination
  rendering behind portal space.
- Retain acknowledgement until one neutral, tunnel-free destination frame has actually been
  presented.
- Replace the current fallback-camera reveal test with explicit converging, settled, and
  scene-activation failure cases.
- Keep generation-current portal presentation alive across the retail authority grace without
  treating `InWorld` as settled readiness or terminal failure.

#### Task checklist

- [x] Hold waiting through static scene loading.
- [x] Hold waiting through dynamic local-player realization.
- [x] Hold waiting through missing EnvCell render scope.
- [x] Hold waiting through camera registration, seed, and convergence.
- [x] Render exit only after the destination uses the settled camera pose/projection.
- [x] Retain that exact settled destination view for the entire exit so readiness cannot regress to
      the portal-only render entry point mid-composition.
- [x] Acknowledge exactly once after the first clean destination frame.
- [x] Reject late readiness from superseded scene/camera/world generations.
- [x] Exercise the core completion-grace path and assert continued tunnel presentation, acceptance
      of late same-generation activation, neutral handoff, and no incomplete destination reveal.

#### Acceptance criteria

- No destination frame displays the seed camera extending into position after portal space.
- Portal space remains animated for arbitrarily delayed but healthy destination prerequisites.
- Cached destinations still show a complete entry and exit instead of flashing through the tunnel.
- The world lifecycle may reach `InWorld` through reveal acknowledgement or core grace, while the
  independent generation-current presentation barrier remains in portal space until neutral
  handoff.
- Focused TypeScript and Rust suites pass.

#### Decisions and course corrections

- One `PortalDestinationReadiness` result owns the generation-current conjunction of activation,
  local realization, origin/scope, viewport/projection, camera currentness, and convergence.
- Fallback, missing, wrong-generation, and explicitly converging camera outputs retain animated
  portal presentation. Only `settled` can enter destination exit.
- A focused Client test now gives the realized player an EnvCell origin while withholding its
  renderer scope. The session continues presenting `tunnel-only`, emits no reveal, and begins exit
  only after that exact scope becomes available.
- The first clean post-exit destination frame drives the one-shot reveal acknowledgement. Activation
  failure explicitly retires transition state, clears the default framebuffer to black, and raises
  the existing presentation error.
- Live initial-entry review disproved the assumption that authority grace implies presentation
  failure: an ordinary outdoor load reached `InWorld` before neutral handoff and the frontend raised
  the generation-1 error at 21.8S, 1.6W. The Client now keys currentness on world generation plus the
  presentation controller, continues polling/loading/rendering after authority grace, accepts a late
  same-generation scene activation, and returns to ordinary world rendering only after neutral
  handoff. Explicit scene-activation failure still uses the terminal cleanup helper; the real-renderer
  fixture proves that path releases both GPU targets and presents opaque black.
- `ClientLifecycleSession` now publishes the generation carried by a portal lifecycle atomically
  with that lifecycle and rejects an older portal event. Presentation currentness therefore does not
  depend on a sibling discontinuity or replacement snapshot winning an event-order race.
- A subsequent live initial-entry run exposed two independent invariant violations immediately
  before neutral handoff. Core's activation settlement moved the final camera point into `initial`
  and then cleared every path leg, contradicting the non-empty wire schema and causing the exact
  `path.legs` decode failure. Settlement now publishes one fraction-1 stationary leg and a core unit
  test owns that contract.
- That decode failure also proved exit scheduling was not monotonic: after exit began, losing the
  current camera presentation re-entered the readiness wait and sent an already-produced
  `tunnel-to-destination` plan to the portal-only renderer. The Client now retains one
  generation-keyed settled `PrimaryCameraView` through exit and clears it on handoff,
  supersession, discontinuity, or failure. A focused test withdraws EnvCell scope after exit starts
  and proves world composition continues without another portal-only render.

### Phase 6: Runtime verification, aesthetic tuning, and cleanup

#### Deliverables

- Use the browser harness to capture deterministic progress samples for:
  - origin-present entry;
  - origin-absent initial entry;
  - extended waiting with tunnel rotation;
  - settled destination exit;
  - resize during entry/waiting; and
  - transition supersession.
- Use the live client probe against a local ACE server for at least one initial login, one outdoor
  teleport, one indoor teleport, and one deliberately cold/delayed destination.
- Capture lifecycle, scene activation, camera convergence, portal phase/progress, presented frame
  count, origin snapshot, and renderer resource evidence at bounded diagnostic cadence.
- Inspect screenshots and short frame sequences rather than relying only on state assertions.
- Profile an inactive baseline and active transition on the real GPU; verify ordinary frames do not
  acquire transition CPU/GPU work.
- Remove temporary probes and sweep obsolete transition/camera vocabulary from code, tests, docs,
  diagnostics, and UI labels.
- Update this plan with final decisions, tuned values, evidence, and any consciously retained debt.

#### Task checklist

- [x] Retain five-sample cold/delayed live timing as external validation debt; do not report the
      deterministic explicit-clock browser fixture as performance evidence.
- [x] Verify enter sound occurs at transition start and exit sound occurs only when settled exit
      begins.
- [x] Verify tunnel animation and rotation continue throughout a multi-second load.
- [x] Verify the first visible destination frame already uses the settled boom camera.
- [x] Verify no origin texture exists on initial entry and exactly one exists during eligible
      teleport entry.
- [x] Verify snapshot/tunnel targets are released after clean handoff, supersession, and exceptional
      clear. Runtime destruction remains covered by owner tests rather than a post-destruction probe.
- [x] Run the full relevant TypeScript and Rust checks.
- [x] Remove temporary browser globals, logging, counters, and screenshots not justified as durable
      harness capability.

#### Acceptance criteria

- Visual review accepts entry, waiting rotation, and exit at representative outdoor and indoor
  destinations.
- No frozen origin frame persists after portal presentation has begun.
- No visible boom solve occurs after portal exit.
- No ordinary-frame performance or resource regression remains when transition state is absent.
- All cleanup vocabulary sweeps and repository checks in the Definition of Done are complete.

#### Decisions and course corrections

- Deterministic 1280x720 SwiftShader captures were taken through the now-explicit compositor
  diagnostic with `origin-to-tunnel`, `tunnel-only`, and `tunnel-to-destination` inputs.
- All captures reported no browser console messages. The origin-present sample allocated exactly one
  RGBA snapshot; origin-absent waiting allocated none. Authored dynamic entity, particle, physics,
  and sky-script counters remained zero in the harness report.
- The browser demo deliberately exercises only the GPU composition seam through an ordinary
  synthetic runtime frame, while client unit tests stop at a fake runtime. Treating those adjacent
  but disconnected checks as lifecycle-to-pixels proof was incorrect and motivated Phases 7-9.
- The initial -0.08/+0.08 review captures were rejected as weak and asymmetric; the later protected
  aperture was rejected as cheesy. Entry and exit now share one exact reversible warp-drive
  treatment. Phase durations remain 1,000 ms/1,000 ms pending motion review. A few vivid magenta
  facets remain in the authored tunnel and need asset/material-path investigation before visual
  sign-off.
- Deterministic seam diagnostics report animation `0x030005ac`, 120 source frames, the selected
  1-119 window, and a fractional 40 fps cursor. Captures at frames 180/181 proved the original hard
  lap and motivated the independent roll clock. The subsequent one-second pose closure was removed
  after live review proved that its interpolated return looked like reverse playback.
- A replacement manually injected exit midpoint capture after removing the extra scale exponent
  shows the shader can display a destination footprint. Repeated live review still observed no exit,
  so this artifact is compositor-only evidence and does not validate production behavior.
- No local ACE world server or Electron client process was available for the required live motion
  review. Browser stills cannot establish pacing or comfort, so visual sign-off remains explicitly
  open rather than inferred from static images.
- Client scheduling tests record `enter` exactly once per new generation, suppress it for duplicate
  lifecycle publication, and record `exit` exactly once when the first settled destination plan is
  emitted.
- The lifecycle fixture found `portalTransitionOnlyFramePresented` assigned to the ordinary render
  path rather than the portal-only path. Moving the assignment to its actual owner makes baseline
  and inactive frames report zero tunnel draws and `false`, while transition-only frames report 42
  authored draws and `true`.
- Five fresh-process SwiftShader runs of the controller-driven authored lifecycle and synthetic
  framebuffer fixtures passed. They repeatedly covered origin-absent entry, origin-present entry,
  extended waiting, supersession, resize, exit, neutral handoff, inactive rendering, and exceptional
  clear. Their startup-contaminated frame samples are not reported as cold-destination performance:
  the fixture advances transition time explicitly and concurrent software rendering would make a
  median or spread misleading. The separate cold/delayed live-client timing item therefore remains
  open.
- The retained harness API, resource counters, and controller-to-pixels fixtures are durable
  regression surfaces: the counters exposed the ordinary/transition-only diagnostic inversion and
  the fixtures identify failures at the controller, runtime, resource, and framebuffer boundaries.
  No portal-specific console logging, temporary screenshots, TODOs, or obsolete production
  `worldEffect`/`tunnelOpacity` vocabulary remains.

### Resteer checkpoint: The phase-to-pixels contract is not proven

The accepted tunnel motion does not rescue the exit architecture. Three live reviews reported no
observable exit while the automated evidence remained green. Inspection found a split proof:

- controller and session tests stop at a fake runtime and prove only that `exiting` progress is
  published;
- runtime code independently enriches that phase with authored animation clocks;
- renderer code reconstructs composition from phase plus nullable snapshot/tunnel resources; and
- browser captures manually inject renderer phases, bypassing the controller and session that own
  the real lifecycle.

Each island can pass while the user-visible chain fails. Further shader tuning is blocked until one
controller-produced instruction travels through the runtime and compositor under automated
observation. The speculative whole-frame dissolve considered after the third review was reverted;
it had no causal evidence and would have deepened the patchwork.

Dry-running the cutover exposes four required boundaries and no need to revisit core camera work:

1. lifecycle state to exhaustive presentation plan;
2. presentation plan to runtime-authored tunnel sample;
3. renderer resource ownership to exhaustive flat-scene compositor input; and
4. compositor input to observable framebuffer pixels.

Phases 7-9 replace and test those boundaries in that order. Loading readiness, camera settlement,
authored tunnel assets, audio identities, and authority acknowledgement semantics stay intact.

### Phase 7: Cut over to a complete per-frame presentation plan

#### Deliverables

- Replace downstream `PortalTransitionState`/`PortalTransitionFrame` phase interpretation with one
  discriminated `PortalTransitionPresentationPlan` (exact name may tighten) matching D10.
- Inject timing into the controller once so it computes progress; reversible transition geometry
  remains renderer-owned and consumers never repeat either decision.
- Replace `tick({ destinationFrameRendered })` with:
  - one pre-render `advance({ nowMs, destinationReady })`; and
  - one post-render `acknowledgePresented(receipt)` operation that cannot advance time.
- Make renderer feedback identify the generation and exact neutral destination presentation that
  completed. Stale or non-neutral feedback cannot acknowledge reveal.
- Delete the duplicate `#portalTransitionFrame()` adapter in
  `client-presentation-session.ts` and `portalTransitionFrame()` adapter in
  `explorer-camera-coordinator.ts`.

#### Task checklist

- [x] Define the exhaustive plan union with no phase-dependent optional fields.
- [x] Make origin-absent begin return `tunnel-only` immediately.
- [x] Make origin-present entry traverse `origin-to-tunnel` before `tunnel-only`.
- [x] Make readiness latch without skipping the required tunnel frame.
- [x] Make ready waiting traverse `tunnel-to-destination` at monotonic progress 0 through 1.
- [x] Separate post-render acknowledgement from clock/state advancement.
- [x] Cut both Client and Explorer over in the same change; retain no compatibility adapter.
- [x] Delete superseded phase/frame vocabulary and its tests in the same sweep.

#### Acceptance criteria

- Reading the controller output alone answers exactly which images this frame must composite.
- Client and Explorer call the transition clock once per animation frame.
- Only a generation-current `destination-only-awaiting-handoff` receipt can emit reveal.
- Type checking makes it impossible to request entry without an origin or exit without a
  destination-bearing plan.
- Production sLOC for controller plus consumer adapters is net-neutral or lower unless the diff
  documents a concrete invariant earned by each added field.

#### Decisions and course corrections

- `PortalTransitionState` is controller-private. Its only public frame output is the exhaustive
  `PortalTransitionPresentationPlan`; neither Client nor Explorer maps lifecycle phases into
  renderer instructions anymore.
- A renderer receipt, not a controller clock call, now opens both visual barriers. A current
  `tunnel-only` receipt proves at least one tunnel frame reached the visible surface before exit;
  a current `destination-only-awaiting-handoff` receipt emits reveal exactly once.
- Renderer feedback keeps the receipt optional because generic non-transition renderer test doubles
  have no honest receipt to manufacture. Both production schedules normalize absence to `null`.
- The controller/consumer cutover adds named plan and receipt contracts rather than meeting the
  provisional net-neutral sLOC target. The added surface earns two enforced invariants—one visible
  tunnel frame and one neutral destination frame—and deletes both phase-to-frame adapters. No
  compatibility path remains.

### Phase 8: Make renderer composition exhaustive and unit-testable

#### Deliverables

- Collapse animation and roll cursors into one named `PortalTunnelVisualSample` carried only by
  tunnel-bearing renderer variants.
- Add one small pure resolver, parameterized over texture/resource handles, that converts a complete
  presentation plan plus renderer-owned resources into the exhaustive flat-scene compositor union.
- Replace `FlatSceneTransitionInput` nullable texture fields and `worldEffect` string inference with
  exact `scene-only`, `tunnel-only`, `origin-to-tunnel`, and `tunnel-to-destination` inputs.
- Make missing origin, tunnel, or destination resources fail with one variant-specific error each.
- Preserve one shared fullscreen implementation for transition-only and ordinary world schedules;
  do not add another render pipeline or generic post-processing graph.

#### Task checklist

- [x] Prove runtime enrichment preserves plan kind, generation, and progress exactly.
- [x] Prove tunnel animation and roll advance independently without altering composition progress.
- [x] Extract and unit-test renderer resource resolution outside the WebGL class.
- [x] Replace nullable sampler enable flags with variant-owned required textures.
- [x] Delete `portalTransitionProgress()`, renderer-side phase validation, `worldEffect`, inferred
      `tunnelOpacity`, and dead snapshot fallbacks.
- [x] Make ordinary inactive frames select `scene-only` without transition allocation or shader work.
- [x] Retain generation-owned snapshot/tunnel cleanup and make every release edge variant-driven.

#### Acceptance criteria

- Every presentation-plan variant reaches exactly one compositor-input variant in a table-driven
  unit test.
- Every required resource has one named consumer and one reachable missing-resource failure test.
- No renderer branch infers visual intent from lifecycle phase or from whether a nullable texture
  happens to exist.
- Both physical scene schedules terminate through the same exhaustive presenter.
- The transition-inactive path remains allocation- and branch-minimal.

#### Decisions and course corrections

- Runtime enrichment is a pure production-used boundary: tunnel-bearing plans receive one composite
  animation/roll sample; the destination-only plan is returned by identity and acquires no tunnel
  dependency. Exhaustive tests reject a missing sample for each tunnel-bearing variant.
- `resolvePortalTransitionComposition()` is parameterized over resource handles and is tested for
  every plan/resource pairing before WebGL state is touched. Missing origin and tunnel resources
  now have variant-specific invariant errors instead of selecting a fallback visual.
- The flat presenter consumes only `scene-only`, `tunnel-only`, `origin-to-tunnel`, or
  `tunnel-to-destination`. The old `worldEffect`, `tunnelOpacity`, nullable-source inference, and
  renderer-side progress reconstruction were deleted.

### Phase 9: Prove controller-to-pixels behavior and remove hollow evidence

#### Deliverables

- Add controller unit tests that assert complete presentation-plan sequences, not merely internal
  phases or `rendered: true` results.
- Add Client and Explorer tests that record one plan per rendered frame and a separate post-render
  receipt; assert no second clock advance occurs.
- Add runtime tests with a recording renderer that prove complete plans are forwarded and enriched
  without reinterpretation.
- Add a deterministic WebGL compositor fixture using synthetic solid-color origin, tunnel, and
  destination textures with color grading disabled. Read pixels directly; do not depend on DAT
  assets, screenshots, visual similarity thresholds, or platform-dependent hashes.
- Replace the lifecycle-bypassing browser transition demo with a sequence mode driven by the real
  controller. A separate fixed compositor fixture may remain only if its name and documentation
  explicitly limit it to shader diagnostics.
- Delete tests that assert only isolated phase publication or manually injected transition states
  while claiming lifecycle coverage.

#### Required behavioral matrix

| Scenario            | Required assertion                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Initial entry       | First plan is `tunnel-only`; no origin allocation or sampler access occurs.                                              |
| Eligible teleport   | Exactly one `origin-to-tunnel` sequence precedes `tunnel-only`.                                                          |
| Delayed destination | Any number of `tunnel-only` frames may occur without timeout or world work.                                              |
| Exit start          | Progress 0 produces tunnel pixels and no reveal receipt.                                                                 |
| Exit midpoint       | Output contains attributable tunnel and destination pixels and differs from both endpoints.                              |
| Exit progression    | Samples at 0, 0.25, 0.5, 0.75, and 1 are ordered, distinct where expected, and destination contribution never decreases. |
| Exit completion     | Neutral output is byte-equal to the untransformed synthetic destination fixture.                                         |
| Reveal              | Acknowledgement occurs once, after renderer feedback for the neutral destination frame.                                  |
| Supersession        | Old-generation plans/receipts cannot capture, compose, release, or reveal the new generation.                            |
| Failure             | Exceptional activation failure selects black/error cleanup and releases all transition resources.                        |

#### Task checklist

- [x] Add table-driven pure controller plan tests for every state edge and early-readiness path.
- [x] Add adjacent-contract tests for Client → runtime and Explorer → runtime plan delivery.
- [x] Add runtime → renderer preservation tests. This became a production-used pure enrichment
      boundary instead of an asset-heavy recording-runtime fixture.
- [x] Add pure resource-resolver tests covering every valid and invalid variant/resource pairing.
- [x] Add exact synthetic framebuffer tests for entry, waiting, exit, and neutral handoff.
- [x] Add a real-controller browser sequence that records plan kind/progress and pixel census on the
      same frames.
- [x] Require the automated sequence to fail if exit progress advances but framebuffer destination
      contribution remains unchanged.
- [x] Run the full TypeScript/Rust checks and the browser matrix before requesting human review.
- [x] Perform live review only after automated evidence proves a material exit transition.
- [x] Sweep misleading “exit verified” claims and obsolete harness flags from code and this plan.

#### Acceptance criteria

- A regression where portal space cuts directly to the destination fails at least one unit test and
  one framebuffer test before human review.
- A regression where exit state advances but renderer pixels do not change reports the exact broken
  boundary rather than a generic screenshot mismatch.
- The browser evidence is produced by the same controller contract used by Client and Explorer.
- Tests distinguish state-machine correctness, runtime forwarding, resource resolution, and GPU
  composition without pretending any one layer is end-to-end evidence.
- Human review is reserved for taste, pacing, and comfort—not for discovering whether exit exists.

#### Decisions and course corrections

- The browser fixture uses a 17x17 RGBA8 target with solid red origin, green tunnel, and blue
  destination textures, disabled color grading, and the production controller, enrichment helper,
  resource resolver, and fullscreen presenter. It reads the framebuffer directly.
- SwiftShader exit samples at progress 0, 0.25, 0.5, 0.75, and neutral handoff produced blue-channel
  sums `0`, `1,355`, `11,955`, `35,487`, and `73,695`. Tunnel green decreased correspondingly, the
  midpoint contained both sources, the final output was byte-exact destination blue, and only that
  neutral frame produced reveal generation 41.
- The fixture throws at the first non-increasing destination sample. A cut from tunnel to destination
  or an advancing plan disconnected from the presenter therefore fails with the broken progression
  index rather than waiting for screenshot review.
- The existing authored-DAT browser compositor diagnostic still freezes inputs for visual
  diagnosis. Its CLI and report vocabulary now explicitly say `compositor-diagnostic` and name the
  exact composition variant; it is not counted as lifecycle evidence.
- Explorer's advance/render/acknowledge schedule moved out of the Svelte component into one narrow
  injected function. Its tests prove one controller advance, unchanged plan delivery, the correct
  portal-only versus world render entry point, and acknowledgement only after that render returns.
- The authored real-renderer lifecycle fixture now covers mid-entry supersession, resize, exit,
  neutral handoff, inactive rendering, and failure cleanup. At 1280x720 it measured one
  3,686,400-byte snapshot and a 7,372,800-byte tunnel target; supersession disposed the snapshot,
  resize changed the tunnel target to 7,091,864 bytes, handoff/inactive returned both to zero, and
  failure cleanup disposed both snapshot generations and read opaque black `[0, 0, 0, 255]`.
- Final pre-cleanup validation passed 236 TypeScript test files / 1,762 tests, all Svelte and
  TypeScript checks, ESLint, Knip, clippy with warnings denied, 253 host tests, and 322 core tests.
  The controller-driven synthetic and authored browser matrices then passed in five of five fresh
  Chrome processes with no browser console errors. Phase 10 reran the expanded 237-file / 1,774-test
  TypeScript suite, both Rust suites, all static checks, and the production WebGL lifecycle fixture.

### Phase 10: Final code-quality audit, plan reconciliation, and commit

#### Deliverables

- Review the complete root diff by ownership boundary: core camera settlement, host projection,
  frontend lifecycle/controller, runtime enrichment, renderer composition/resources, app tuning,
  and browser evidence.
- Delete or collapse duplicated policy, vestigial vocabulary, speculative public surface, hidden
  defaults, test-only production structure, and avoidable state/branching discovered by the audit.
- Record only domain-independent smells discovered during the review in
  `docs/code-quality-audit-patterns.md`; local defects and one-off implementation notes remain here.
- Reconcile historical incomplete checkboxes with explicit evidence, waiver, or retained debt rather
  than leaving ambiguous work behind.
- Run the final TypeScript, Rust, browser, formatting, lint, and diff verification matrix; inspect the
  resulting diff and commit only the portal-transition change.

#### Task checklist

- [x] Audit every touched production boundary and its focused tests.
- [x] Address all in-scope quality findings and sweep superseded vocabulary.
- [x] Add any newly evidenced universal quality smells to the audit worksheet.
- [x] Reconcile the missed baseline, cold/delayed timing, and live-review plan items.
- [x] Run the complete final verification matrix and inspect staged scope.
- [x] Commit the reviewed portal-transition change without ACE/ACViewer submodule dirt.

#### Acceptance criteria

- Every surviving contract field, branch, helper, metric, and tuning value has a named production or
  diagnostic consumer.
- Client and Explorer share visual policy deliberately while retaining only genuinely mode-specific
  timing policy.
- Tests prove lifecycle, boundary preservation, resource ownership, and framebuffer behavior without
  preserving superseded architecture.
- The plan status and Definition of Done distinguish completed implementation from consciously
  retained external/live-review debt.
- The final commit contains no unrelated submodule or workspace changes.

#### Decisions and course corrections

- The audit deleted an impossible post-loop camera-settlement branch, a test-only transition-policy
  default, unused exported controller state, a dead portal-only clock field, and duplicated plan
  validation in the runtime, renderer, and flat presenter.
- The Explorer host's duplicate “standard” boom profile was deleted; both client and Explorer now
  consume core's single convergence/collision policy and vary only explicit reach requests.
- Renderer transition drawing and clearing are required production capabilities. Runtime tests now
  use one explicit full-renderer fixture instead of weakening the production contract with optional
  methods; the animation scheduler accepts only the feedback field it actually consumes.
- `PortalTransitionPresentationPlan` owns generation/progress validation. Finite and range failures
  remain distinct and have direct tests.
- The Explorer adapter was advancing exit readiness when activation was ready but the destination
  was not renderable. Exit now latches readiness only from their conjunction, with a focused
  regression test.
- The audit worksheet gained the domain-independent “State Preserves a Control-Flow-Impossible
  Outcome” pattern. Existing patterns already covered the other findings.
- Final SwiftShader evidence used the production authored tunnel, controller, runtime, renderer,
  and synthetic framebuffer fixture. It reported no browser console messages and retained exact
  black cleanup plus resource-release invariants.

## Known Concessions and Retained Debt

- **Authored browser diagnostic is intentionally not lifecycle evidence:** controller, Client,
  Explorer, runtime
  enrichment, resource resolution, and synthetic GPU progression are covered. The authored-DAT
  diagnostic still accepts manually frozen composition inputs for asset and shader inspection; its
  explicitly composition-oriented naming prevents it from being cited as production lifecycle
  evidence.
- **Missed pre-cutover image baseline:** causal behavior was frozen in tests, but no screenshot of
  the former simple blend/non-rotating tunnel was saved before implementation. Reconstructing it
  now would require reverting the cutover and would add no production evidence.
- **Visual tuning remains intentionally adjustable:** entry and exit traverse one reversible radial
  zoom-history smear in opposite directions. Client and Explorer share one explicit visual policy:
  30 maximum zoom, 1 acceleration exponent, 5 streak intensity, 2 world-opacity exponent, and
  0.01-1.0 radial-smear bounds. Their one-second phase durations remain app-local. The twelve
  history samples and 0.65-0.95 luminance gate remain implementation constants until either gains a
  distinct tuning scenario. Rejected pinch, aperture, asymmetric-exit, and pose-closure tuning has
  been deleted rather than retained as dormant configuration.
- **Magenta tunnel facets need provenance:** deterministic captures contain several bright magenta
  polygons. They appear to originate in the authored portal visual/material path rather than the
  fullscreen warp, but that inference must be verified before changing assets or fallback policy.
- **GPU teardown after runtime destruction is inferred, not sampled:** direct browser evidence now
  covers resize, supersession, clean handoff, inactive rendering, and exceptional clear. Renderer
  destruction still needs a device-lifecycle census if active-resource accounting after object
  teardown is required beyond the existing owner-level destruction tests.
- **Live-client matrix is incomplete:** representative initial login, outdoor teleport, indoor
  teleport, and cold destination runs still require a running local ACE/client environment and
  human review of the first destination frames.
- **Core terminal presentation failures need a typed host projection:** core tests prove the
  seven-second authority handoff, and Client tests prove presentation may safely outlive it through
  late activation and neutral reveal. Runtime scene-layer failures already produce black/error, but
  core-only body unavailability or camera-settle exhaustion is not projected as a typed frontend
  failure. Authority `InWorld` cannot substitute for that missing fact. A live Town Network grace run
  and any future terminal-failure projection remain part of the retained external-contract debt.
- **One unrelated core test showed a transient order-sensitive failure:** the first post-fix full
  run observed two collision-preparation requests where
  `vector_demand_promotes_and_demotes_with_no_content_reload` expected one. The unchanged test
  passed immediately in isolation and the following complete 322-test run passed. No touched camera
  or presentation dependency reaches that assertion, so this is retained as test-health evidence,
  not attributed to the portal cutover without a reproducible causal path.

## Risks and Mitigations

### Transition-only rendering duplicates the world renderer

**Risk:** A second frame pipeline could accumulate its own animation, resource, and state rules.

**Mitigation:** Limit it to portal animation advancement, tunnel-target drawing, and final
presentation. Share those exact helpers with ordinary exit frames. It must never collect world
geometry or emit normal frame feedback.

### Exhaustive render plans absorb lifecycle policy

**Risk:** Moving from generic phases to presentation variants could make the renderer-facing type
own readiness, authority, or timing decisions that belong to the controller.

**Mitigation:** Keep lifecycle state and readiness private to the controller. The plan is an output
value for one frame, not a second state machine: it carries only generation, required visual source,
progress, and warp policy. Runtime and renderer may validate and enrich it but cannot choose another
variant.

### Synthetic framebuffer tests become implementation snapshots

**Risk:** Pixel tests tied to authored assets, whole-frame hashes, or exact aesthetic constants would
be brittle and could freeze poor visual design.

**Mitigation:** Use tiny synthetic solid-color inputs, disable grading/dither, and assert semantic
properties: endpoint identity, both-source contribution at intermediate progress, monotonic
destination contribution, and resource selection. Keep aesthetic screenshots and live review
separate from correctness gates.

### Origin capture occurs after portal pixels replace the world

**Risk:** A late capture would snapshot the tunnel, causing recursive-looking superseded transitions.

**Mitigation:** Make capture a generation edge against the last completed world target. Record the
source choice before the first transition-only presentation and reject recapture for an active or
superseded portal generation.

### Initial entry accidentally samples an absent texture

**Risk:** Boolean/null coupling could produce black flashes or undefined sampler behavior.

**Mitigation:** Use the discriminated origin source through the controller/runtime boundary and an
explicit shader enable uniform. Tests and harness captures cover origin-absent entry from frame one.

### Camera settlement is defined as desired reach equality

**Risk:** Walls and other valid obstruction permanently keep rendered reach below desired reach,
stranding portal space.

**Mitigation:** Compute convergence inside the controller from the collision-constrained target and
filter/motion state already owned there. Include an obstruction-limited settled test before exposing
the field on the wire.

### Activation camera settlement accidentally enables gameplay early

**Risk:** Reusing the ordinary runtime tick path could run player simulation, movement feedback, or
network actions during portal space.

**Mitigation:** Keep `active_world` and ordinary simulation gates unchanged. Invoke a narrowly named
camera-only settle operation from activation convergence, and add negative tests for movement, jump,
network actions, dynamic batches, and lifecycle publication.

### Accelerated camera settlement consumes excessive synchronous work

**Risk:** Repeated collision/portal solves could block the core task if convergence is slow or
impossible.

**Mitigation:** Use named profile-owned convergence tolerances plus a deterministic hard
iteration/work bound. Emit no intermediate results. Exhaustion remains a named core outcome; do not
misclassify authority grace as its frontend error projection. Add a typed host failure fact before
giving exhaustion a terminal black/error UI.

### Warp parameters create edge seams or motion sickness

**Risk:** Aggressive UV motion can expose texture borders or make a frequent transition unpleasant.

**Mitigation:** Clamp the transform domain, use smooth zero-derivative easing at phase boundaries,
start with restrained amplitude, inspect motion sequences at common aspect ratios, and keep every
strength in one app-local tuning block.

### Tunnel rotation becomes nondeterministic or contaminates the boom

**Risk:** Ambient randomness makes captures flaky, while rotating the primary camera corrupts
residency and convergence.

**Mitigation:** Derive deterministic targets from transition generation/segment and apply them only
inside the virtual tunnel transform. Assert primary camera diagnostics remain unchanged.

### Destination work leaks through the loading presentation

**Risk:** Rendering a partial world behind an opaque tunnel may still run expensive or stateful
systems prematurely.

**Mitigation:** Use transition-only presentation until the complete destination view exists. Resume
ordinary world rendering only for the bounded exit, after readiness is satisfied.

### Retail completion grace conflicts with indefinite visual waiting

**Risk:** Core may enter `InWorld` after its proven grace while the frontend still lacks a safe
destination presentation.

**Mitigation:** Preserve the authority policy while retaining the generation-current presentation
barrier independently. Continue animated portal rendering until neutral handoff; clear to black only
for an explicit presentation failure. Never manufacture convergence or show an incomplete
destination.

### Retail markers overclaim compatibility

**Risk:** A screen-space warp could be mislabeled as reproducing retail's unknown shader behavior.

**Mitigation:** Cite the proven view-distance ramp, label our replacement as `RETAIL DIVERGENCE`,
state the consequence of “correcting” it, and record the exact runtime branch census. Cite tunnel
rotation separately as the behavior actually observed in the decompile.

## Definition of Done

- [x] Portal space begins rendering immediately on initial entry and teleport once transition assets
      and a canvas extent exist, independent of destination readiness.
- [x] Teleports optionally capture exactly one final origin frame; initial entry explicitly allocates
      and samples none.
- [x] Origin entry warps smoothly into the authored tunnel with no frozen-frame pause.
- [x] The authored tunnel animates and rotates continuously throughout an arbitrarily long load.
- [x] Destination loading, player realization, render scope, and camera convergence remain
      generation-current and fail loudly on actual errors.
- [x] Core settles the boom in one bounded activation operation without granting gameplay authority
      or emitting intermediate camera playback.
- [x] Core computes one explicit camera convergence fact; no frontend rederives it.
- [x] Portal exit begins only after the complete destination readiness conjunction is true.
- [x] Destination exit materially applies the inverse retail-inspired warp and ends on an exactly
      neutral frame; controller-driven framebuffer tests prove both properties.
- [x] The first tunnel-free destination frame already uses the settled boom camera.
- [x] Reveal acknowledgement is emitted exactly once after that clean frame.
- [x] Supersession cannot capture portal pixels, reveal stale content, or leak prior-generation GPU
      resources.
- [x] Enter/exit sounds remain one-shot and aligned with their presentation edges.
- [x] The screen-space warp contains a complete `RETAIL DIVERGENCE:` marker and retail citations;
      tunnel rotation cites its proven retail behavior accurately.
- [x] Transition-only presentation does not advance world animation, particles, ambience, gameplay
      simulation, or controls.
- [x] Ordinary frames perform no transition rendering, allocation, timing, or shader work when the
      transition is inactive.
- [x] Focused and full relevant TypeScript tests pass via `npm run test:ts`.
- [x] Svelte/TypeScript checks pass via `npm run check`.
- [x] TypeScript lint and touched-file formatting checks pass with warnings treated as failures.
- [x] Rust tests covering core client camera/activation pass through the package-manager scripts or
      the repository's canonical Cargo invocation.
- [x] Rust formatting and clippy pass with warnings denied.
- [x] Browser harness verification covers deterministic initial-entry, teleport, delayed readiness,
      supersession, resize, and resource teardown cases.
- [x] One exhaustive presentation-plan contract replaces phase interpretation, nullable compositor
      resources, duplicate Client/Explorer adapters, and the second per-frame controller tick.
- [x] Unit tests locate failures independently at controller planning, consumer delivery, runtime
      enrichment, and renderer resource resolution boundaries.
- [x] Synthetic framebuffer tests prove exit progress materially changes destination contribution
      and reaches a byte-neutral endpoint.
- [ ] Live-client verification covers representative outdoor and indoor destinations without
      running the interactive TUI.
- [x] Temporary diagnostics and obsolete transition/camera vocabulary are removed.
- [x] This plan records final tuned values, evidence, decisions, and any consciously retained debt.

## Open Questions

None requiring an immediate design choice. Camera settlement tolerance/work bounds are implementation
policy proven by focused tests, explicit scene-activation failure uses black plus the existing error
UI, and the missing typed projection for core-only terminal presentation failures is retained debt.
Visual rotation/warp tuning occurs after the structural transition path is working.
