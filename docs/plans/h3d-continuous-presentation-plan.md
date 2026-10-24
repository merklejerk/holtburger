# Continuous world backdrop with overlaid character previews

Status: Phases 1–6 complete. Technical checks pass; the user exercised loading/reveal and reported characters-first working after the clock fix. 2026-10-24.

## Execution evidence and steering

The initial camera/compositing gate was accepted by the user ("yeah looks fine"). Production content classifies `0x0138ffff` as `dungeon-only`; the supplied camera is used directly in scene axes with normalized orientation. Existing portal-junction validation emits authored overlap warnings; readiness and rendering succeed. The agent has not performed visual acceptance.

`ClientPresentationRoot` now retains the app-owned canvas, world owner/runtime, audio and workers across pregame/gameplay. It serializes borrower retirement and installs either `ClientPregameBackdrop` or `ClientGameplayPresentation`. Graphics and audio settings belong only to the root, removing the gameplay adapter's duplicated settings state/setters. Gameplay retains authority, camera, environment and portal policy. Failed content installation can retry with withdrawn/reissued demand; failed construction or withdrawal blocks further driver admission, including queued replacements, because reusing uncertain mutable state is unsafe.

`ClientGameplayView` borrows the shell canvas. Drag/drop uses a common DOM interaction boundary containing both canvas and HUD; keyboard routing mounts at app lifetime, and pregame declares native controls for roster arrows/Tab. Selection overlays the scene; creator keeps its existing retail-room preview and pauses/silences the retained backdrop. Calendar time excludes hidden intervals; existing bounded script/particle catch-up remains runtime policy, with historical script sounds suppressed on the first resumed frame.

The production-content proof exposed existing lifecycle defects: untracked static eviction futures, pending sky mesh work surviving renderer/cache teardown, and lazy particle resources surviving renderer destruction. Fixes stay at those owning boundaries. Sky staging now also releases a failed closure-acquisition job so a later attempt can recover. A real ClientApp return also exposed an action-bar subscriber reconciling after character settings withdrawal but before Svelte unmount; it now checks session character ownership. The old startup-theme fixture omitted the existing required visual-cache bridge; its fixture now supplies that capability.

Verification:

- `npm run harness:browser -- --client-presentation --brief`: checked-in production ClientApp route with controlled authority, real content and local settings/cache. Selection -> creator Face/Body/Cancel -> portal reveal -> gameplay -> selection; native roster arrows, same physical canvas, one world context request, no browser errors. `/tmp/h3d-continuous-final-client-app-keys.log`.
- `npm run harness:browser -- --pregame-preview --brief --gpu`: candidate ready/draw, hidden/resumed behavior, outdoor Rainy environment (three sky scripts, 25 emitters, sound and ambient scheduling), two gameplay portal handoffs on one owner, stable program count after warmup, canceled construction, later equipped preview, zero retained GPU resources/setup leases and no browser errors. `/tmp/h3d-continuous-final-pregame-gpu.log`.
- Diagnostic startup spans from that single hardware-GPU run: world construction 336 ms, candidate preparation/first ready frame 1792 ms, 512x512, render scale 1, AMD Radeon RX 7900 XT / ANGLE Vulkan (radv 26.2.5), fixed candidate/radii from tuning, existing shared CPU bootstrap excluded. These spans are not complete app cold-start timings or a performance conclusion; future budget/optimization claims require repeated isolated runs with workload/hardware recorded.
- `npm run harness:browser -- --client-mouse-movement --brief`: actual Chrome mouse movement/steering/capture/cancellation pass with no browser errors. `/tmp/h3d-continuous-final-mouse.log`.
- Full `npm run harness:browser -- --client-hud --brief` passes (exit 0). Its startup-refusal fixture records/asserts the exact deliberate presentation error separately from unexpected browser errors. Native pregame scope, missing startup fixture bridge and fixture canvas cursor styles were also corrected. The app and HUD fixture now import the same `client-canvas.css`. An isolated Chrome probe confirmed native `:active` can stay latched after pointer unlock even with released buttons; cursor feedback now reads controller-owned button state through a DOM attribute, cleared on release/cancel/retirement. Hover assertions run where their samples are taken, before unrelated navigation: `/tmp/h3d-continuous-final-hud7.log`.
- `npm run test:ts`: 3431 tests / 387 files pass. `npm run check`: zero Svelte errors/warnings, app/test/Electron checks pass. Full `npm run lint` including dead-code analysis and Clippy passes. `npm run build` passes with the bundle-size advisory; portal assets remain intentionally available pregame. Logs: `/tmp/h3d-continuous-final-{tests,check,lint,build}.log`.

Final quality review removed the lifetime probe's redundant HTTP endpoint table in favor of the shared harness content transport, corrected rename/comment leftovers, and checked changed-file formatting. Quality review traced root/app mode selection, borrower startup/retirement, late profile publication, gameplay camera/entity work, sibling-canvas input, static eviction, sky preparation and renderer destruction. Removed obsolete owner factory, construction cue buffering and duplicate settings ownership. Snapshot packaging, caching policy and a world/preview context merger remain deferred. No new shared-crate or host protocol abstractions were needed. The initial standalone backdrop showcase was deleted after the actual ClientApp route superseded it.

Final review validation: 3432 tests / 387 files, app/test/Electron type checks, zero Svelte errors/warnings, TypeScript lint, dead-code analysis and changed-file formatting pass. The production-content GPU preview/lifetime suite passes again after removing the duplicate transport, with no browser errors (`/tmp/h3d-review-{tests,check,lint,pregame}.log`). Earlier full Clippy, build, production loading-gate and HUD runs remain applicable; the final cleanup changes only harness transport reuse, comments, a local variable name and formatting. No remaining blocking finding was identified within the reviewed frontend lifecycle, runtime teardown and immediate consumer seams.

Final review route (replaces the initial proof route): `http://127.0.0.1:38411/harness/browser/?client-presentation=1&contentHost=http%3A%2F%2F127.0.0.1%3A35847`. User accepted the final production composition ("yeah looks fine"). No real server character mutation is used by the probes.

## Context and boundaries

**Goal:** Show character selection over a real DAT scene, retain existing character-preview rendering, and reuse the persistent world renderer for gameplay.

The user clarified that characters are screen overlays, not actors placed in the location. This removes staged world actors, character anchors, topology/collision placement, captured-idle integration into world animation, and creator-room integration into world rendering from this plan.

### Scope

In scope:

- One persistent world canvas, WebGL2 device/runtime, audio context and worker composition per app/content-transport lifetime, shared by pre-game backdrop and gameplay.
- Existing independent model-preview canvas/service for character selection, creator and inspector. Selection transparently overlays the backdrop; creator retains the retail room in its existing preview.
- One fixed DAT backdrop using the supplied camera, existing streaming/portal readiness, sky/weather/audio and normal resource eviction.
- Full-screen backdrop and modern selection composition using existing UI primitives, preserving roster, explicit entry and creation behavior.
- Borrowed gameplay presentation, safe mode handoffs, input ownership, errors, settings and teardown.
- Phase 6 extension: loading/connection screen until the authority has supplied the character roster and the existing backdrop readiness reports ready; reveal character selection and its background together.

Out of scope:

- Characters participating in backdrop depth, occlusion, lighting, shadows, collision or gameplay identity.
- A single WebGL context for both rendering paths, a new compositing pass, shared GPU buffers across contexts, stage APIs or fake live entities.
- Scene recipes/snapshots/exporters, prepared asset packages, new caching, location catalogs/cycling, last-region policy, decorative actors or simulation replay.
- Reworking creation commands, appearance persistence, protocol or gameplay authority.
- New complete-preload guarantees, stripping portal assets, or Explorer UI/control reuse.

The persistent-context guarantee applies to the **world renderer**. The visible model preview continues to own a separate WebGL context under the existing single-active-preview service. Both borrow app-owned CPU/content capabilities, but their GPU resources are separate. Existing preview mounts may replace their device across surfaces; retaining a preview device across selection/creation is not required by this feature.

### Candidate camera

```text
Camera(scene)
landblock = 0x0138ffff
envCell   = 0x01380180
position  = (232, -3.751, -10467.59)
rotation  = (w=0.995, x=-0.0998, y=0, z=0)
```

`client-location-command.ts::formatClientLocation` prints `CameraPlacement` directly: absolute canonical scene position, camera-to-world quaternion, wxyz order. Do not convert this as an AC player position or infer outdoor context from the owner suffix. Normalize the rounded quaternion once; keep FOV/near/far in app-local tuning using current client defaults initially. Verify cell/profile and camera context through production content. No character anchor or ground query is needed.

User decision: keep the creator's retail room, including resolved `backgroundSetupDid`, portrait framing, body/face camera, independent subject rotation and headgear behavior. The room remains inside the existing creator preview canvas. It does not become a world scene.

## Ground truth

Paths below are relative to `apps/holtburger-3d/src/`.

| Source                                                                                                                                     | Role                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `client/ClientApp.svelte`                                                                                                                  | `usesWorldPresentation` currently owns gameplay construction and lifecycle-branched UI; app owns shared CPU assets and teardown stack.    |
| `client/ClientWorldView.svelte`                                                                                                            | Canvas, viewport mouse handling, hover sampling, resizing and HUD consumers must survive canvas extraction.                               |
| `client/client-presentation-session.ts`                                                                                                    | Current owner factory/destruction, authority subscriptions, camera/environment and portal coordination.                                   |
| `lib/game/runtime/game-presentation-owner.ts`                                                                                              | Constructs world renderer/audio/workers/sky/ambient/portal assets without requiring gameplay.                                             |
| `lib/game/runtime/host-presentation-assets.ts`                                                                                             | Shared app-owned content capabilities borrowed by both rendering paths.                                                                   |
| `lib/game/runtime/game-presentation-runtime.ts`                                                                                            | Explicit camera/environment/listener, `activateScene`, `sceneActivationStatus`, `completeSceneActivation`, gameplay entities and cleanup. |
| `lib/game/runtime/scene-availability.ts`, `scene-target.ts`, `render-scene-interest-controller.ts`, `scene-interest-commit-coordinator.ts` | Scene classification, exact replacement, readiness, dispatch identity and retry implications.                                             |
| `explorer/ExplorerApp.svelte`, `explorer/explorer-camera-coordinator.ts`                                                                   | Existing fixed-location/offline presentation and local environmental clock patterns; do not import Explorer UX.                           |
| `client/client-location-command.ts`, `lib/game/runtime/types.ts`, `lib/assets/ac-frame.ts`                                                 | Camera frame and placement contracts.                                                                                                     |
| `client/ClientModelPreview.svelte`, `lib/game/renderer/webgl2-preview-renderer.ts`                                                         | Existing overlay renderer requests `alpha: true` and clears to transparent black. CSS/status surfaces still need a composition audit.     |
| `client/ClientCharacterSelect.svelte`, `client/client-character-preview.ts`                                                                | Selected-only cache reads, synchronous identity gating, roster/entry behavior.                                                            |
| `client/ClientCharacterCreator.svelte`, `client/client-character-creation.ts::CharacterCreationPreviewResolver`                            | Existing retail-room composition, latest-only resolution and accepted creator behavior.                                                   |
| `client/client-environment.ts`, `lib/game/environment/scene-environment.ts`, `lib/game/systems/sky-script-system.ts`                       | Local environmental selection and normal asynchronous weather activation.                                                                 |
| `lib/assets/web-audio-device.ts`, `lib/game/systems/audio-system.ts`                                                                       | Normal first-use audio warmup and listener controls.                                                                                      |
| `harness/browser/PregamePreviewHarness.svelte`, `pregame-world-lifetime-probe.ts`                                                          | Extend existing production-content equipment and lifetime verification.                                                                   |

DAT interpretation follows current content code, ACE/ACViewer and retail references where needed. Do not modify the retail decompile. No new protocol interpretation is expected.

## Constraints and concessions

- World renderer lifetime follows app/content-transport identity, not selection, draft changes, tabs or gameplay mode.
- One active world driver and one world frame scheduler; preview keeps its existing separate animation loop. Hidden preview work stops under existing lifetime/visibility policy.
- Gameplay authority stays in existing Rust/session layers. Backdrop camera, local environment and overlay layout are frontend policy.
- Preserve existing static readiness and normal later audio/weather warmup. Preview loading is independent: missing or failed cached appearance never blocks the roster or entry.
- Host startup/authentication and event consumption continue concurrently with backdrop loading. Phase 6 keeps the loading/connection screen visible until both roster and existing backdrop readiness are available. Progress/errors and disconnect remain accessible.
- Existing retention/eviction remains; a persistent context does not guarantee permanent content residency or GPU sharing with previews.
- Candidate indoor classification governs sky/weather/audio. Do not force rain or outdoor sound into a closed dungeon.
- Existing context-loss policy remains. No live character mutations or interactive TUI diagnostics are required.
- Creator is an opaque foreground view with its existing portrait preview/room. Keep the candidate backdrop installed, pause background drawing and silence its listener while creator is shown; resume on return without rebuilding the world runtime. No seamless environment transition is required.

## North stars

1. **Backdrop and character are separate compositions.** No world placement, depth interaction or staged actor abstraction.
2. **One persistent world lifetime.** Pre-game-to-game exchanges controllers rather than rebuilding renderer, workers and audio.
3. **Keep the working preview path.** Preserve equipment, idle continuity, room composition and creator controls instead of integrating them into world animation.
4. **Explicit ownership and latest publication.** Old gameplay loads, cues or cleanup cannot mutate a newly installed backdrop.
5. **Reuse existing loading contracts.** Gate backdrop reveal like portals; do not invent full preload or caching guarantees.
6. **Future sources remain replaceable.** Scene choice lives outside renderer drawing; existing source ports remain available for later snapshots.
7. **Subtract before abstracting.** Remove gameplay-owned renderer construction, keep the new root focused on lifetime/handoff, and add no scene framework.
8. **Measure separate costs honestly.** World reuse, preview allocations and retained CPU assets are different facts.

## Naming cutover and survey

Rename responsibilities when they change, in the same phase as their callers, tests, comments, diagnostics labels and durable documentation. Source-reference paths above describe the current tree. The target names below describe the implementation. No compatibility aliases, parallel old/new entry points, or unrelated shared-runtime vocabulary sweep.

| Current / proposed earlier                                                                                                                                                  | Target                                                                                                                                                        | Reason and phase                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClientPresentationSession`, `client-presentation-session.ts` and colocated test                                                                                            | `ClientGameplayPresentation`, `client-gameplay-presentation.ts` and matching test                                                                             | Gameplay authority/camera/portal adapter borrowing persistent presentation; Phase 2.                                                                                         |
| New app-level imperative owner                                                                                                                                              | `ClientPresentationRoot` in `client-presentation-root.ts`                                                                                                     | Owns persistent world resources and active-driver handoff; Phase 2. It is not a replacement for host/session authority.                                                      |
| Previously proposed `ClientPregameScene`                                                                                                                                    | `ClientPregameBackdrop` in `client-pregame-backdrop.ts`                                                                                                       | Supplies background location/camera/environment only; no character staging; Phases 1/3.                                                                                      |
| `ClientWorldView.svelte`                                                                                                                                                    | `ClientGameplayView.svelte`                                                                                                                                   | After canvas extraction still owns gameplay HUD and viewport interaction. Prefer this over `ClientGameplayHud`, which understates retained input responsibility; Phase 2.    |
| `ClientPresentationSessionDependencies`                                                                                                                                     | `ClientGameplayPresentationDependencies`                                                                                                                      | Adapter dependencies become borrowed capabilities; Phase 2.                                                                                                                  |
| `ClientPresentationOwnerFactory`                                                                                                                                            | Delete                                                                                                                                                        | Root constructs resources; no factory compatibility path remains in adapter/tests; Phase 2.                                                                                  |
| `ClientPresentationOwner` structural contract                                                                                                                               | `ClientGameplayPresentationResources`                                                                                                                         | Borrowed capability, without `destroy()`; root alone owns destruction. Keep it colocated with its consumer; Phase 2.                                                         |
| `ClientPresentationRuntime` structural port                                                                                                                                 | `ClientGameplayRuntime`                                                                                                                                       | Narrow gameplay consumer port, not the complete runtime or a new implementation; Phase 2.                                                                                    |
| Gameplay-owned `ClientPresentationStatusKind`, `ClientPresentationStatus`, `ClientPresentationFrame`, `ClientPresentationDiagnostics`, `ClientPresentationCameraController` | Corresponding `ClientGameplayPresentation…` types                                                                                                             | Existing status includes awaiting snapshot/player/portal activation and diagnostics refer to controlled gameplay. Prevent accidental reuse as root/backdrop status; Phase 2. |
| `clientLifecycleUsesWorldPresentation` / `usesWorldPresentation`                                                                                                            | `clientLifecycleUsesGameplayPresentation` / `usesGameplayPresentation`                                                                                        | Existing predicate covers entry/portal/in-world, not app/world-device lifetime. Preserve those phase semantics, remove its role as renderer-construction gate; Phase 2.      |
| `clientLifecycleEnablesWorldInput` / `worldInputEnabled`                                                                                                                    | `clientLifecycleEnablesGameplayInput` / `gameplayInputEnabled`                                                                                                | Controls live character interaction, not backdrop or preview UI input; Phase 2.                                                                                              |
| App `presentationSession`, `worldView`, `retirePresentation`, `presentationRetirements`, teardown label `world-presentations`                                               | `gameplayPresentation`, `gameplayView`; delete adapter-retirement helper; use `presentationRootRetirements` / `presentation-roots` for actual root retirement | Distinguish retiring adapters from destroying the persistent world composition; Phase 2.                                                                                     |
| HUD output prop `onCanvas` and HUD-local owned canvas binding                                                                                                               | Delete output; receive borrowed `canvas`                                                                                                                      | Physical canvas moves to app shell; avoid callback names claiming the HUD creates it; Phase 2.                                                                               |

Keep `GamePresentationOwner`, `GamePresentationRuntime`, `HostPresentationAssets` and `HostPresentationResources`: they remain shared world resource/runtime and app content responsibilities across Explorer/client. The new lifecycle does not justify a broad `Game` -> `Scene` rename.

Keep `ClientModelPreview`, `ClientObjectPreviewService`, `StandardClientObjectPreviewService`, `ClientCharacterPreview`, `CharacterPreviewState`, and `CharacterCreationPreviewResolver`: preview rendering, single-active admission, cached character loading and creator resolution remain their existing jobs. Likewise retain authority `ClientLifecycleSession`, `ClientLifecycleUiState`, world generation/portal terms and `ClientWorldPanel`/container names, which refer to genuine authority/domain concepts.

Audit remaining exports in the renamed adapter by responsibility rather than global text replacement. A reusable ray/residency type should move to its actual owner only if another real consumer needs it; a gameplay-only type should get explicit gameplay vocabulary. Keep root/backdrop status local and minimal; do not force unrelated phases into the existing gameplay status union. Do not rename host protocol fields, resource identifiers or lifecycle discriminants for frontend cosmetics.

## Architecture and lifecycle

```text
ClientApp / ClientPresentationRoot
  owns persistent world resources + frame scheduler; app shell owns physical canvas
  borrows HostPresentationAssets
  serializes active world driver
      +-- ClientPregameBackdrop: fixed DAT target, camera, local environment, listener
      +-- ClientGameplayPresentation: borrowed resources, live authority/camera/portals

Foreground UI
  selection: existing transparent ClientModelPreview + roster/actions
  creator: existing portrait ClientModelPreview with retail room + editor
  gameplay: HUD; inspector may open existing model preview

World and preview devices borrow CPU content assets; GPU resources are separate.
```

```text
mount/content ready -> construct world owner + prepare candidate behind loading UI
  -> static ready -> reveal backdrop and selection UI
  -> select character -> existing cache/preview replacement only (no world demand change)
  -> Create -> opaque creator; pause backdrop draw, silence backdrop listener
  -> cancel/confirmed creation -> resume backdrop and existing selection preview behavior
  -> explicit Enter -> retire preview surface and pre-game driver
  -> attach gameplay adapter to same world owner
  -> existing authority/portal destination gate -> reveal gameplay
  -> supported return to selection -> drain gameplay -> activate fixed backdrop
  -> shutdown -> retire drivers/previews -> destroy world owner -> shared assets/transport
```

### Borrowed gameplay adapter

Replace `ClientPresentationSession`'s production owner factory/construction/destruction with a borrowed presentation capability. Keep gameplay camera, environment, subscriptions and portal coordination in that adapter. App/root owns construction rollback, settings/capability publication and final teardown.

Handoff: withdraw old admission -> unsubscribe/invalidate -> invalidate runtime desired live entities -> drain owned async work and camera stop -> clear old gameplay effects/cues/selection/hover/indicator/viewer/listener/portal state -> install next driver -> resume frames. Audit initialization, discontinuities, snapshot replacement, camera synchronization and failure paths. A guard only in an adapter `.then()` cannot prevent runtime-internal actor publication; withdraw its desired live set before draining.

Do not run cleanup after new backdrop installation. Distinguish root ownership epoch, authority world generation and portal generation. Keep actual cancellation observable and distinguish obsolete cancellation from real failures.

The root scheduler delegates frame ordering to one active world driver. Gameplay `frame()` already owns tick/render order; do not add unconditional root `runtime.frame()` alongside it. Continue pumping commits while loading, independently of reveal and player availability. Preview loops remain independent and bounded by their existing surfaces.

### Viewport, overlays and audio

Lift the world canvas above lifecycle branches. Gameplay HUD borrows it for current input/picking behavior; its mouse/hover handlers mount only under gameplay ownership. Preserve viewport attributes, keyboard policy, resize/projection and HUD placement. Pre-game background has no movement/picking controls; preview owns subject rotation and creator framing.

Selection preview uses its existing alpha context over the world canvas. Audit parent CSS to remove opaque wells only where needed; preserve readable missing/loading/error statuses and controls. Preview framing uses its overlay rectangle, not the full world viewport. Browser compositing supplies layering: character never disappears behind world geometry and receives preview lighting.

Creator retains its current room/portrait composition and opaque foreground layout. Pause backdrop drawing and withdraw its audio listener while creator is visible; retain resources and location demand. Reset local frame timestamps on resume so hidden time does not create oversized deltas or queued sound bursts. A simple implementation may drain pending static work without rendering while hidden. Existing preview admission prevents concurrent selection/creator previews. Retain inspector behavior unchanged.

## Phases

### Phase 1 — Prove the fixed backdrop and transparent overlay

Deliverables: app-local `client-pregame-backdrop.ts` tuning/controller skeleton and existing browser harness extension; no production cutover yet.

- [x] Verify supplied camera cell/profile/classification with actual production loaders.
- [x] Resolve fixed scene demand and activate using current pipeline/radii; keep receipt and pump to ready/failed.
- [x] Set primary view, local environment and camera listener; render candidate through world runtime.
- [x] Compose existing equipped transparent model preview over it without world actors; verify no opaque wrapper hides the backdrop.
- [x] Retain retail creator preview unchanged and prove hide/pause/resume policy for background draw/audio.
- [x] Include an outdoor harness fixture for sky/weather/audio if candidate is indoors.
- [x] Record construction/preparation timing spans on hardware GPU and separate world/preview resource counts. Complete app cold-start budgeting is deferred; no performance conclusion follows from this one diagnostic sample.

Acceptance: candidate loads at supplied camera and model preview composites independently; no browser/content failures. User reviews composition. No anchor, spatial-membership or model-only-world-room proof is needed.

### Phase 2 — Persistent world ownership and borrowed gameplay

Deliverables: focused imperative `ClientPresentationRoot`, lifted canvas in `ClientApp`, adapted HUD and borrowed `ClientGameplayPresentation` with ownership tests.

- [x] Move world owner construction/destruction, settings/capability publication and scheduler to app/content-transport lifetime.
- [x] Extract canvas without duplicating gameplay input/resize logic; migrate `ClientWorldView` to `ClientGameplayView` and pass the same element as a borrowed input. Remove the obsolete `onCanvas` output.
- [x] Replace gameplay owner factory and destroying rollback paths with borrowed capability; rewrite related tests around ownership rather than factory scaffolding. Apply the naming-cutover table, including adapter/file/test names and gameplay-only contract types.
- [x] Serialize handoff/currentness/drain; remove `retirePresentation` and update callers and teardown stack so borrowers retire before owner, shared assets and transport.
- [x] Preserve host startup/auth progress/errors and subscriptions while rendering initializes. Rename gameplay predicates and locals without broadening their existing authority-phase semantics or using them to gate root construction.

Acceptance: existing gameplay/portals work; gameplay adapter stop does not destroy shared resources; root stop destroys world composition once, including pending construction. Mode changes never recreate world device/audio/workers. Pre-game cannot send movement/picking input.

### Steering A — Ownership audit

- [x] Walk delayed startup, entry, portal/resync, supported return, disconnect and teardown through actual implementation.
- [x] Verify old snapshot/profile/camera/cleanup work cannot mutate next driver.
- [x] Reassess remaining work against measurements; reject stage-actor, snapshot or renderer-unification scope expansion.

### Phase 3 — Production backdrop and overlay cutover

Deliverables: pre-game driver, selection backdrop/layout, persistent-root app integration; existing preview/creation services retained.

- [x] Drive fixed target, explicit local environmental time through existing calendar resolver, user settings and camera-positioned listener without server-time dependency.
- [x] Reveal backdrop at static readiness; keep roster/preview loading independent and error/disconnect accessible. Show explicit backdrop retry on content failure.
- [x] Keep `ClientCharacterPreview` selected-only cache reads and identity gating; retain `ClientModelPreview`, `previewService` props, appearance contracts and creator capability gates.
- [x] Overlay roster/actions and transparent character preview; preserve explicit entry, capacity/pending/slot metadata, missing/corrupt-cache messaging and keyboard access.
- [x] Retain creator retail room, portrait framing, Custom only, Skills & Stats, randomize clothes, body/face, hidden face-mode headgear, unchanged idle and submission recovery.
- [x] Apply opaque creator foreground plus paused/silent retained backdrop; resume on cancel/confirmed creation without scene reactivation or world device reconstruction.
- [x] Activate backdrop only per environment installation, never per GUID/draft change. Retain loading receipt. Retry explicitly withdraws failed demand before reissuing: identical demand alone does not cause the coordinator to dispatch again.

Acceptance: selection overlays real scene and creator retains current room/behavior. Exactly one world composition plus at most the admitted preview composition is active. Preview failure does not strand roster/entry; background failure is explicit and retryable. User accepts visual composition.

### Phase 4 — Transitions and resource verification

- [x] Selection A/B/missing/corrupt; creator heritage/room changes, body/face, cancel, rejected/retried submission and confirmed creation preserve existing behavior.
- [x] Explicit entry -> authority portal -> gameplay and existing subsequent portals; supported authority return -> backdrop. Do not invent a logout command.
- [x] Race cases: owner-build abort, scene failure/retry, cache/appearance completion after navigation, resync, delayed camera stop, quit during pending work.
- [x] Assert gameplay actors/cues/effects/input cannot leak into backdrop and previews cannot publish under wrong identity or remain mounted after entry.
- [x] Track world canvas/device/runtime/workers/audio identity separately from preview allocations. Repeated transitions stay bounded; app teardown releases both paths before shared CPU assets.
- [x] Verify creator-hidden backdrop produces no draws/audible ambience and resumes without bursts or giant deltas.
- [x] Count loads separately from residency; prove no world device/program reconstruction, not universal cross-context GPU sharing or permanent asset hits.
- [x] Exercise candidate interior and outdoor weather/audio fixtures; retain existing equipment, preview lifecycle and portal regression coverage.

Acceptance: focused machine assertions pass with no browser errors/double teardown/resource growth. The broad HUD command also passes. No character mutation is used as diagnostic side effect.

### Steering B — Review loading and composition

- [x] Evaluate cold load and repeated transition evidence against accepted readiness semantics.
- [x] Flag broad unexpected refactors, memory growth or scheduling regressions before cleanup.
- [x] Keep source packaging, cross-context GPU unification and new preload/cache policies deferred; record measured follow-up opportunities.

### Phase 5 — Cleanup and final validation

- [x] Remove obsolete gameplay-owned world construction/destruction vocabulary, callbacks/styles/tests. Sweep old adapter/component/predicate names from imports, tests, diagnostics labels and current documentation; historical inactive plans are not migration targets. Preserve preview paths; they are intentional consumers.
- [x] Review added lines and remove duplicate world scheduling, state mirrors and input logic. Root owns lifetime/handoff, not gameplay behavior.
- [x] Update app README/architecture with persistent world ownership, separate alpha previews, readiness concession, creator pause/audio and shutdown order.
- [x] Focused tests per phase; final app `npm run test:ts`, `npm run check`, `npm run lint`, `npm run build` and relevant existing browser harness suites. Fix warnings. Rust checks only if Rust changes become necessary.
- [x] Code-quality pass complete over ownership/contracts/currentness/frame ordering/resource bounds; user accepted final selection, creator and transition visuals.

Acceptance: checks and machine verification pass, user accepts visuals, no staging/commit unless requested.

### Phase 6 — Coordinate loading, connection and pregame reveal

Status: complete. User exercised the release controls in both orders and reported characters-first working on retry ("It works this time"). Phases 1–5 remain completed and accepted. A dedicated `ClientLoadingPage` displays app-owned status/actions; `ClientApp` owns readiness and page composition.

Execution: extracted the loading/connection/error shell into `client/ClientLoadingPage.svelte`, reused native keyboard policy and existing theme controls, and replaced inline picker loading with one derived roster/readiness admission value. The app conceals the retained canvas until admission while continuing its existing frame loop. Authority mode changes and root replacement clear old backdrop status before another picker can mount. Selected-preview loading, creator pause/resume, root ownership and renderer readiness APIs remain unchanged. Failed startup retires authority subscriptions, so accepted disconnect now also applies the existing absorbing frontend exit action; the host still receives the original disconnect command.

Evidence: `npm run harness:browser -- --client-presentation --brief` passes with explicit fixture barriers for both arrival orders, authentication progress, empty roster, failed scene/retry, failed connection/disconnect, delayed gameplay retirement, creator cancel/resume and native roster keys. It checks that the scene actually draws behind the concealed loading page, that no picker/preview is mounted early, and that world canvas/context identity is retained. Report: `/tmp/h3d-loading-browser-final2.log`. Full HUD/startup/keyboard suite passes in `/tmp/h3d-loading-hud-final.log`. An earlier run reported an animation-timestamp assertion (`/tmp/h3d-loading-hud.log`). A clean rerun was insufficient evidence to dismiss it: the user subsequently reported characters-first stalling, and the review server recorded the same exception at 10:14:44. That exception exits the presentation callback before its next frame is scheduled. A producer/consumer regression delivering the same timestamp twice reproduced the exception before the fix (`/tmp/h3d-clock-regression-before.log`). `startPresentationFrameLoop` now delivers presentation work once per display timestamp while continuing to schedule after a duplicate; sampler validation remains strict, with timestamp values added to its error diagnostic. This is a frame-loop boundary fix, not a change to scene readiness. The clock tests pass (`/tmp/h3d-clock-regression-after.log`). The production-app probe now uses physical Chrome mouse clicks for both release orders and injects a repeated timestamp before reveal; it passes with no browser errors (`/tmp/h3d-clock-browser.log`). The user has also reported characters-first working on retry. Full HUD/startup regression for this fix passes (exit 0) in `/tmp/h3d-clock-hud.log`.

Final app checks/lint/build and unit test logs after the clock fix are `/tmp/h3d-clock-{check,lint,build,tests}.log` (3432 tests / 387 files pass). The build retains its existing bundle-size advisory. No new runtime assets, host protocol or shared-crate changes were needed. Source review covered page selection, status invalidation, loading progress, retry/disconnect and creator ownership; no new coordinator, readiness latch or frame receipt was introduced.

User review: `http://127.0.0.1:46757/harness/browser/?client-presentation=1&presentation-gates=1&contentHost=http%3A%2F%2F127.0.0.1%3A42481`. The two harness buttons release characters and scene independently. The user owns visual acceptance. The user accepted the result and authorized a final code-quality review and commit.

**Goal:** Keep one loading/connection screen up until character selection and its background can be shown together.

**North stars:** Reuse existing readiness, keep connection and content loading concurrent, and keep the change in frontend composition. Add no new frame receipt, renderer handshake, general startup coordinator, preload system or stronger readiness guarantee. Character-preview loading remains independent.

Ground truth, relative to `apps/holtburger-3d/src/`:

- `client/ClientApp.svelte`: currently renders `ClientCharacterSelect` immediately for authority `character-selection`; `backdropStatus` independently controls loading/error text and background styling. The app frame loop already receives the backdrop result and publishes changed cold status.
- `client/client-pregame-backdrop.ts::frame`: polls the existing activation receipt, sets ready when `sceneActivationStatus` is ready, and performs the normal draw in that same call. No additional proof of a presented frame is needed for this gate.
- `client/client-presentation-root.ts`: already constructs resources early, pumps loading and serializes mode changes. Preserve this ownership and scheduler.
- `client/client-gameplay-presentation.ts::#portalDestinationReadiness`: uses the same scene activation signal, with additional player/camera requirements specific to gameplay. Do not import those gameplay requirements into pregame.
- `client/client-lifecycle-state.ts`: projects authority connection/authentication/roster state. Preserve the meaning of those states; scene loading is frontend presentation policy, not a new host lifecycle state.
- `harness/browser/ClientPresentationHarness.svelte`, `pregame-gameplay-fixture.ts`, `scripts/client-presentation-probe.mjs`: extend existing controlled-authority/real-content verification.

The app composition owns this admission rule:

```text
connection/authentication + backdrop preparation proceed concurrently
  roster received AND existing backdrop status ready
    -> reveal background and mount character selection together
```

A supplied empty roster satisfies the connection condition. Before admission, selection actions and creator entry are absent; the loading/connection screen owns keyboard interaction. Startup/connection failure and exit take precedence over reveal.

Deliverables and checklist:

- [x] In `ClientApp.svelte`, combine authority `character-selection` with existing `backdropStatus.kind === "ready"` at the UI composition boundary. Derive the decision once for markup/style consumers; do not add a retained readiness latch, broaden the authority lifecycle, or create a general state machine.
- [x] Retain connection/authentication messages while awaiting the roster. Once the roster is available but the scene is pending, show scene preparation in that same loading shell instead of mounting the picker with an inline "Preparing scene" message.
- [x] Keep the loading shell opaque and the background concealed until admission, including when the scene finishes before the connection. Continue the existing root/frame loop and static commit pumping behind it; UI reveal must never become a resource-construction or rendering prerequisite.
- [x] Mount character selection only after both inputs are ready. Keep its existing selected-only cache reads, model preparation and missing/unavailable placeholders. Do not pre-mount a hidden picker, preload all characters or creator assets, or gate on preview readiness.
- [x] Preserve startup/connection errors, scene failure diagnostics, existing retry eligibility and disconnect through the loading shell. Reuse the current root retry and disconnect handlers; introduce no timeout-based success or new connection retry mechanism.
- [x] Apply the same rule on supported return from gameplay and root replacement. `backdropStatus` currently retains its last pregame ready value while gameplay frames run: clear that existing cold status to loading synchronously at the relevant app transition before selection markup can mount. Do not wait for the next animation frame to withdraw stale readiness. Reuse existing status/mode ownership; add no ready latch or frame receipt.
- [x] Preserve creator pause/resume: use readiness, never canvas visibility or `rendered`, as the admission input. The creator intentionally hides/pauses backdrop drawing while retaining a ready installation; opening it must not cause its own unmount. Keep existing gameplay and portal entry behavior.
- [x] Extend the production-app harness with controlled ordering: roster first/scene pending, scene first/roster pending, both ready, and empty roster. Assert that neither picker nor background is exposed early, then that both reveal once the two conditions hold. Use controlled fixture barriers rather than arbitrary sleeps.
- [x] Cover scene failure/retry, connection failure/exit while loading, and return to selection without stale-ready reveal. Retain creator cancel/resume and native roster keyboard coverage. Assert the existing world canvas/context survives these UI gates.
- [x] Cleanup: remove the superseded inline scene-loading treatment inside the visible picker, reuse current loading shell/styles, and update the README to describe coordinated admission with independent preview loading. Keep production changes localized to app composition unless a concrete consumer requires otherwise.
- [x] Validate with app checks/lint/build and the focused `--client-presentation` browser suite; run existing affected lifecycle/backdrop tests and startup-theme coverage as appropriate.
- [x] User reviewed the loading/reveal behavior, reported an ordering stall, and confirmed characters-first working after the frame-loop fix.

Acceptance: either prerequisite arriving alone leaves the loading/connection screen visible; both prerequisites reveal selection over its ready background. Loading continues behind the gate, failures remain actionable, empty rosters work, creator pause cannot revoke admission, and return from gameplay uses current readiness. No new renderer readiness API or frame receipt is introduced. Existing later weather/audio warmup and character-preview loading retain their current contracts.

Decisions and concessions:

- User explicitly chose the existing scene readiness contract. "Ready" does not acquire a new promise that every future audio/weather effect has been preloaded.
- Initial cached character previews may still show their existing loading/missing/unavailable state after page admission. Preparing them behind the loading screen is outside this extension.
- Waiting for the connection is a presentation barrier; it does not serialize scene loading after authentication or alter host/session authority.

## Risks and mitigations

| Risk                                            | Mitigation                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Two devices mistaken for one shared GPU cache   | Explicit separate world/preview ownership; shared CPU sources only; instrument independently. |
| Overlay opaque well blocks backdrop             | Verify existing alpha clear and audit parent CSS/status surfaces.                             |
| Preview and background lighting differ          | Accepted screen composition; preserve preview lighting, user judges presentation.             |
| Old gameplay cleanup erases backdrop            | Serialized withdrawal/invalidation/drain before next admission.                               |
| Candidate closed dungeon hides weather          | Preserve indoor rules; outdoor fixture proves environmental reuse.                            |
| Lifted canvas breaks HUD picking/input          | Audit all consumers/viewport attributes; gameplay-scoped handlers.                            |
| Loading freezes its own progress or retry hangs | Pump commits while hidden; preserve receipt; retry with fresh demand dispatch.                |
| Creator-hidden backdrop wastes resources/audio  | Pause drawing, withdraw listener, retain location, reset timing on resume.                    |
| Context retention grows memory forever          | Existing eviction/retention and repeated-handoff resource checks.                             |

## Definition of done

- [x] Candidate scene uses correct supplied camera behind screen-space character preview; no character world placement added.
- [x] Retail creator room and all accepted creation/preview behavior remain intact.
- [x] One world composition persists through pre-game/gameplay; separate preview lifetime is explicit and bounded.
- [x] Existing readiness/environment/streaming rules retained; preview missing/loading does not block entry.
- [x] Clean entry/portals/supported return/shutdown, no stale authority or preview publication.
- [x] Paused creator backdrop is silent and resumes correctly.
- [x] Tests/checks pass, including the broad HUD suite, teardown drains resources, and user accepted the final visuals.
- [x] Naming cutover is complete with no compatibility aliases, obsolete owner factory, or gameplay predicate still controlling world-device lifetime.
- [x] No snapshot/cache/stage-authority abstractions or unnecessary shared-crate changes.
- [x] Phase 6: loading/connection screen waits for roster plus existing backdrop readiness; coordinated reveal, errors/retry, empty roster and return-to-selection behavior are verified, with user review and clock regression resolved.

## Decisions and open questions

- Phase 6 decision: gate pregame reveal on roster received plus existing backdrop readiness. No new frame receipt or stronger asset readiness, and no preview-loading gate.
- Previews overlay the scene; they are not placed inside it. Previous stage-actor design is removed.
- Creator retains retail room via existing preview renderer. No creator scene migration needed.
- First candidate camera, final selection overlay layout and FOV have user visual acceptance; no actor placement data is required.
- Local pre-game calendar/environment uses explicit tuning and existing resolution; no new settings UI required. Indoor suppression remains intentional.
- Startup budget is unspecified; record reproducible measurements before proposing optimization.
- Follow-up: catalog/last-region selection and optional packaged snapshots through existing content ports. None require changing overlay appearance contracts or renderer drawing policy now.
