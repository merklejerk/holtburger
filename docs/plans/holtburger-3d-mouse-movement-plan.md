# Client mouse steering and forward movement

Status: implemented and verified; user visual acceptance remains separate.
Date: 2026-10-23.

## Goal and boundaries

Add configurable held mouse movement to the h3d client: RMB steers the character with the camera behind them; MMB or LMB+RMB supplies the same forward action as W.

In scope:

- Three independently persisted switches in Settings > Input, enabled by default: right-button steering, middle-button forward, and left+right-button forward.
- Continuous horizontal steering, explicit rear-follow activation, and pointer-lock lifecycle.
- Coexistence with keyboard movement, autorun, ordinary jumping, precise targeting, selection, examination, and existing viewport cancellation.
- A narrow typed host boundary for facing, using existing movement authority where its semantics fit.
- Focused unit tests and automated browser/runtime evidence.

Out of scope:

- Arbitrary mouse rebinding, chord capture, a generalized multi-device input framework, or new movement owners.
- New sensitivity or camera transition settings, and changes to Explorer controls. Vertical RMB camera pitch was added in the follow-up below.
- New physics, movement speeds, wire protocol messages, or camera collision algorithms unless investigation proves an existing path cannot express the feature. Escalate such a discovery as a scope change.
- Agent-performed visual acceptance. The user owns that check.

## Ground truth and existing paths at planning time

- `apps/holtburger-3d/src/client/ClientWorldView.svelte`: viewport DOM ownership, capture, selection/examination, orbit, precise-jump pointer interactions, and cancellation registration. RMB currently examines on press; LMB clicks select and drags orbit.
- `src/client/client-viewport-pointer-gesture.ts`: existing click/drag threshold and gesture advance logic. Extend or replace this path; do not install a competing gesture owner.
- `src/client/client-input-arbiter.ts` and `src/lib/game/controls/character-input-controller.ts`: ordinary versus precise input, autorun, held actions, opposed-axis ordering, gait, and jump lifecycle. Held actions currently have no keyboard/mouse source identity.
- `src/client/ClientApp.svelte`: input composition, settings replacement, ordered movement dispatch, and camera translation notifications. Its camera notification currently includes turning as well as translation; account for actual call-site behavior rather than relying solely on camera comments.
- `src/lib/game/camera/possession-camera-controller.ts`: orbit, recenter dwell/transition, rear pinning, and host camera session. Current client tuning is in `src/client/client-tuning.ts`.
- `src/lib/input/{input-contract.ts,input-defaults.ts,app-input.ts,viewport-input-gate.ts,keyboard-input-policy.ts}`: resolved policy, fixed pointer button maps, viewport gating, and keyboard ownership.
- `src/client/{client-input-settings.ts,client-settings-contract.ts,client-settings-defaults.ts,client-settings-sections.ts,ClientSettingsPanel.svelte}`: strict persisted keyboard settings, defaults, section loading, and existing Input UI. Paths above beginning with `src/` are relative to `apps/holtburger-3d/`.
- `apps/holtburger-3d/src/client/{client-host-contract.ts,client-lifecycle-session.ts}` and `apps/holtburger-3d/host/src/{client_host.rs,client_runtime.rs}`: typed browser-to-host adapter. Drive currently carries discrete left/right turning only.
- `crates/holtburger-core/src/client/movement_types.rs` and `movement/system.rs`: `PlayerDriveIntent::SnapFacing`, manual control, client-directed commands, interruption rules, and physics-tick application. `SnapFacing` is a candidate, not yet a proven continuous-steering solution. `AcquireFacing` acquires a separate client-directed owner and must not be issued per mouse sample.
- `acclient-eor-source/acclient.c:142885`: `CameraSet::MouseLookHandler`; follow its calls and command interpreter paths if core facing semantics require clarification. Decompile names alone are insufficient evidence of behavior. Use ACE as server/protocol ground truth if publication behavior needs investigation. Do not modify the decompile.

## Behavior contract

| Input                                    | Result                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| RMB held                                 | Explicit rear-follow; horizontal mouse displacement rotates character facing. No displacement means no mouse turn. |
| MMB held                                 | Forward action while its switch is enabled.                                                                        |
| LMB+RMB held, in either press order      | Forward action while its switch is enabled; RMB also steers if its own switch is enabled.                          |
| One chord button released                | Remove the chord's forward source immediately. Remaining RMB can continue steering.                                |
| LMB alone                                | Existing select click and free camera orbit.                                                                       |
| RMB click without drag or movement chord | Examine on release.                                                                                                |

Additional invariants:

- The character owns steering yaw. The camera follows the character's facing with no retained free-orbit yaw offset. Preserve pitch and zoom. Reuse the existing recenter duration for entry; steering bypasses the movement dwell. On release, retain the existing sticky rear-follow behavior until free orbit releases it.
- Use existing yaw sensitivity tuning. Do not synthesize time-based A/D presses from mouse displacement.
- Forward behaves like W, including the walk modifier and autorun cancellation. Each physical source enters the existing newest-first longitudinal arbitration only when its semantic action becomes newly held; repeated pointer samples do not reorder it.
- Releasing W cannot release surviving mouse-forward. Releasing MMB cannot release a surviving two-button chord, or vice versa. Preserve ordinary keyboard behavior and opposed-axis precedence.
- Preserve A/D behavior during steering. Account for each mouse yaw change once alongside host keyboard turning; never continually resend an old absolute heading that undoes keyboard turns. Verify the chosen composition in Phase 1.
- Once an enabled movement chord occurs, consume pending selection, examination, and precise-jump activation for that gesture, even if the pointer never moves. Do not resurrect the click when one button is released.
- When steering is disabled, the enabled two-button forward chord still works. When chord-forward is disabled, merely holding both buttons must not create forward movement. Resolve simultaneous enabled gesture intents in the single viewport owner.
- Follow existing precise-mode policy: suppress mouse-forward while precise targeting owns longitudinal movement; retain turning. Do not restore a forward hold started during precise mode on exit without a fresh press. Turning or forming a movement chord must not activate a precise jump.
- HUD interactions cannot begin world movement. Preserve the app's keyboard ownership policy for editors and ordinary controls; mouse input must not bypass a modal or viewport blocker.

## Architecture and lifecycle

```text
Viewport DOM events + pointer lock + validated mouse settings
    -> one app-local viewport gesture owner
       -> click/orbit/steering intent and physical forward-source edges
    -> existing client input composition
       -> semantic held drive + semantic facing change
    -> typed host adapter
    -> core movement authority and existing publication/physics path
    -> presented character facing -> rear-follow camera
```

The frontend input layer owns buttons, chords, click consumption, sensitivity, and cancellation. The app-local host adapter validates and transports semantic intent. Core movement owns applying facing and publishing movement. Camera presentation owns rear-follow and collision through the existing boom session. No browser button vocabulary enters shared Rust crates.

Keep hot pointer/facing state imperative. Add only the minimal keyboard/mouse hold bookkeeping required by the real inputs. Derived forward eligibility and click consumption are computed by their owning layer once. Do not create parallel keyboard and mouse drive publishers that overwrite one another.

Acquire pointer lock when RMB becomes a committed steering drag, using the existing drag threshold so a right-click remains examination. Handle a pending asynchronous lock acquisition as part of the gesture lifetime: a late success after release/cancellation must immediately relinquish lock. While locked, consume relative displacement and reconcile button state on all relevant events. Pointer capture alone is insufficient for unlimited turning.

Handle button changes while another mouse button is held through the browser events that actually report them; do not assume every chord transition generates a fresh `pointerdown`/`pointerup`. Choose one coherent event path after browser verification, without duplicate dispatch from pointer and mouse listeners. Prevent native middle-button autoscroll and context-menu behavior for owned gestures.

Release movement sources, pending clicks, pointer lock, and steering ownership on blur, pointer cancellation/capture loss where applicable, viewport blocking, settings replacement, world discontinuity, disconnect, or teardown. Cleanup must be idempotent. Pointer-lock loss or refusal ends steering and queued yaw, while physical forward holds remain active until release. The mouse owner does not intercept Escape; existing game handling retains priority. Distinguish intentional capture-to-lock handoff from true cancellation. Never resume canceled holds merely because a blocker disappears. If lock acquisition fails, report through existing app feedback and end steering cleanly; do not silently pretend continuous steering is available.

## Implementation phases

### Phase 1: Prove the movement and browser seams

- [x] Trace `SnapFacing` through physics application, publication, manual movement, jump charge, combat interruption, and server-directed motion. Prove whether it can safely coexist with held drive and repeated mouse deltas.
- [x] Select the narrowest semantic facing contract. Prefer existing core behavior; if an absolute heading would lose intervening turns or overwrite accumulated samples, compose deltas at the authority layer that owns current facing. Do not accumulate heading from lagging rendered poses.
- [x] Specify cadence and ordering: coalesce hot steering updates without dropping accumulated displacement; do not grow an IPC promise queue per pointer sample. Preserve ordering against release, reset, and jump edges. Document how pending updates are invalidated across world lifetimes.
- [x] Verify chord event delivery, partial releases, relative movement, pointer-lock acquisition/failure, and Escape behavior in the browser harness and Electron runtime where behavior differs.
- [x] Record the chosen contract, event path, and evidence here before proceeding. Reassess scope if reuse requires new movement architecture or physics changes.

Acceptance: a concrete facing path preserves manual forward/strafe/jump state, and a demonstrated DOM event path observes both chord orders and every partial release. No assumption that camera orbit changes character facing remains.

### Phase 2: Add persisted mouse configuration

- [x] Introduce a client input settings shape containing the existing keyboard groups plus the three mouse switches. Keep keyboard-only utilities typed to the keyboard subset where that is their actual responsibility.
- [x] Update schema, defaults, settings sections, consumers, and resolved app policy. Supply mouse defaults for older saved input sections without replacing saved keyboard bindings; reject malformed supplied fields.
- [x] Add a Mouse section using existing controls and styles. Keep keyboard binding restore distinct from restoring all input, with labels matching their actual effect.
- [x] Cancel active gestures before installing changed settings. Cover load/save, missing-field migration, invalid values, and independent switches.

Acceptance: all three switches persist and take effect independently, old keyboard settings survive migration, and no disabled gesture remains active after a settings change.

### Phase 3: Integrate movement, gestures, and rear-follow

- [x] Extend the existing gesture owner to cover RMB click-versus-steer and MMB/two-button forward, removing the immediate RMB examination path.
- [x] Add the minimum physical-source composition needed for keyboard and mouse holds. Feed the existing arbiter rather than bypassing autorun and precise-mode rules.
- [x] Wire the proven typed facing path through the host adapter. Keep movement updates and lifecycle cleanup coherent.
- [x] Expose explicit rear-follow activation using the camera's existing pin/transition machinery. Do not simulate translation to trigger recentering or maintain a second camera yaw authority.
- [x] Integrate pointer lock, click suppression, hover suppression during steering, browser defaults, and shared cancellation. Restore ordinary pointer picking after the held mouse gesture ends.
- [x] Add focused tests for gesture transitions, source composition, camera ownership, host contract validation, and any changed core behavior.

Acceptance: RMB rotates the character with the camera behind; both forward gestures behave like W; releasing one source leaves the others intact; gestures cannot accidentally select, examine, or activate a jump after movement; cancellation leaves no stale input or pending steering update.

### Phase 4: Cleanup and end-to-end verification

- [x] Remove superseded gesture branches and stale fixed-pointer/keyboard-only terminology where the meaning changed. Retain honest keyboard-only names for actual keyboard subsets.
- [x] Review additions for unnecessary abstractions, duplicate derived facts, unused fields, and avoidable branching. Record approximate line impact and justify the remaining machinery.
- [x] Run targeted `npm run test:ts -- ...`, `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and formatting checks for changed files from the app directory. Run relevant Rust tests and `npm run lint:rust` if Rust changes; treat warnings as errors.
- [x] Use `npm run harness:browser -- ...` with focused input fixtures/probes. Exercise actual browser button delivery and pointer lock as well as synthetic transition tests. Use Electron probes where required; do not run the TUI.
- [x] Record commands, outcomes, prerequisites, and unresolved limitations here. Leave visual feel and acceptance to the user.

Acceptance matrix:

- Both chord orders, no-movement chord consumption, release of either button, transitions from LMB orbit to chord steering, and RMB click versus drag.
- W plus each mouse source, MMB plus chord overlap, S precedence, A/D plus steering, walk modifier, autorun, ordinary jump charge/release, and precise-mode entry/exit.
- Free-orbit to rear-follow, sustained rear-follow during steering, pitch/zoom preservation, and release followed by LMB orbit.
- Every switch independently disabled, saved settings reload, live settings changes while held, and preservation of keyboard bindings.
- Focus/editor/modal transitions, pointer-lock failure or late acquisition, game Escape routing and capture loss while forward is held, pointer cancellation, portal/world replacement, disconnect, and component teardown.

## Risks and decisions

- **Facing reuse is unproven:** core already distinguishes manual and client-directed ownership. Phase 1 must demonstrate composition rather than attaching mouse samples to a convenient but incompatible command.
- **Browser chord delivery:** a design listening only for pointer press/release edges can miss additional mouse-button changes. Empirical browser evidence is required before selecting the event seam.
- **Rear-follow latency:** camera motion must follow the authoritative/presented character coherently. Do not conceal lag by introducing a separate predictive character yaw without evidence it is necessary.
- **RMB examination changes timing:** examination moves from press to click release. This is the deliberate UX concession that permits steering and forward chords to coexist with examination.
- **Entry transition:** use the existing recenter duration, bypassing its dwell; no new configurable transition. User acceptance may adjust this single policy later.
- **Defaults:** enable all three requested gestures for both new settings and migrated settings. Retain an independent off switch for each.

## Definition of done

- [x] All behavior and cancellation invariants pass focused unit and runtime checks.
- [x] Mouse configuration persists without losing existing keyboard customization.
- [x] Character rotation remains authority-owned; camera uses existing rear-follow and collision behavior.
- [x] No generalized binding framework, extra movement owner, or new sensitivity control was introduced. Vertical RMB movement adjusts camera pitch through the existing camera owner.
- [x] Required checks pass, evidence and material limitations are recorded, and user visual acceptance is identified separately.

## Resolved implementation questions

Phase 1 selected core-relative yaw over renderer-derived absolute headings, one mouse event path for chord edges, and bounded frontend coalescing into the existing ordered input dispatch. The evidence below records the implementation and runtime checks. There are no outstanding implementation blockers.

## Implementation evidence and decisions

- Relative mouse displacement now enters the existing `replace_client_drive` boundary as `rotate-facing`. The host validates finite displacement and forwards `PlayerDriveIntent::RotateFacing`. Core accumulates relative input in `PendingFacing` and composes it with the ordinary physical root-motion reference. Accepted facing is published through the existing autonomous-position sender after simulation; absolute facing corrections retain their separate snap path. A/D, forward/strafe, and jump charge remain independent. Absolute facing resets the preceding relative baseline; manual held-drive acquisition preserves relative input. Reset, server takeover, and world-epoch retirement discard it.
- Frontend displacement is summed behind one scheduled submission. Explicit drive/jump edges flush earlier displacement into the existing ordered dispatch lane; cancellation invalidates queued callbacks, and the world-input lifetime prevents an old session from accepting them. No IPC job is created per mouse sample under transport backpressure.
- Chrome's real event stream confirmed that a second mouse-button press and partial release are pointer moves, while mouse events carry every press/release. The viewport now has one mouse gesture owner; pointer events maintain hover separately. Window mouse delivery covers releases outside the canvas; the shared input policy owns blur/visibility/editor/modal cancellation. This replaces pointer capture for mouse gestures, so lost pointer capture is no longer a mouse resource boundary.
- RMB enters existing rear-follow immediately, bypassing the movement dwell and using the existing transition duration. Horizontal steering changes character facing; the camera has no separate steering yaw. Free orbit releases the rear pin. Pitch and zoom remain in the existing camera owner.
- RMB examination now commits on click release. A movement chord consumes the entire pending click. Settings are three independent switches; keyboard reset preserves them. The obsolete configurable client pointer maps were removed rather than retained as unused policy.
- Mouse gestures do not register an Escape context or depend on keyboard routing. Escape retains existing game behavior. Pointer-lock loss/refusal shares steering-only cleanup, preserving forward buttons and keyboard holds; a fresh RMB hold is needed to resume steering. Full viewport cancellation reuses that cleanup and additionally releases the held mouse sources. Refusal still publishes a warning toast.
- Real browser checks exposed a cursor-restoration bug: retaining the absolute drag origin after pointer lock could emit a reverse turn on unlock. The lock transition now discards that origin, and the runtime probe asserts that unlock adds no reverse yaw.
- Approximate production impact before the physical-integration follow-up below: +532 physical lines, including comments and whitespace, excluding tests, browser fixtures/scripts, this plan, and the pre-existing ACE submodule modification. The necessary additions are a single DOM gesture owner, bounded relative-yaw dispatch, three settings, a narrow semantic movement variant, and explicit entry into existing rear-follow. No additional movement owner, arbitrary binding system, sensitivity preference, or transition preference was added. Vertical pitch was subsequently added as described below.

Verification collected so far:

- `npm run check`: passed, zero Svelte errors or warnings.
- Focused TypeScript tests for input arbitration, displacement dispatch, settings migration, drag classification, camera rear-follow, binding mutation, lifecycle transport, and Electron host protocol: 149 passed across eleven files.
- `cargo test -p holtburger-core --lib`: 691 passed after the physical-integration follow-up. Movement cases cover accumulated displacement, preserved forward/strafe/turn and jump charge, and cancellation by reset/server/world boundaries. The coupled simulation/camera regression covers idle steering, forward movement, and simultaneous A/D turning.
- `cargo test -p holtburger-3d-host client_host::tests`: 21 passed, including signed relative-yaw JSON decoding.
- `npm run harness:browser -- --client-mouse-movement --brief`: passed with no browser errors, including actual settings-checkbox interaction and accepted-value checks. Covers both chord orders and partial releases, source overlap, keyboard precedence, autorun, precise suppression, independent switches, live settings cancellation, click suppression, editor/blur/pointer cancellation, existing game Escape routing with forward held, capture loss/refusal preserving forward, locked steering-to-orbit handoff, rear-follow activation, real pointer lock, lock refusal, late acquisition cleanup, and unlock displacement.
- The same production viewport probe passed inside an isolated Electron `BrowserWindow` using production-equivalent renderer isolation settings (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`), with zero runtime exceptions. This was one-off evidence from a temporary runner that started Vite and loaded the asset-free client HUD fixture; that runner is not part of the repository. The checked-in repeatable entry is the Chrome browser harness above. No live account or TUI was used.
- `npm run harness:browser -- --client-bindings --brief`: passed; keyboard editor/reset and shortcut presentation still work.
- `npm run lint:rust`: passed with `-D warnings`. Cargo reports an upstream `binrw` future-incompatibility notice; there are no Clippy warnings.
- `npm run harness:browser -- --client-hud --brief`: passed in the final isolated run, including all three Mouse switches through their actual controls and the existing HUD, inspection, targeting, precise-jump, theme, inventory, and keyboard-policy checks. The three warnings are deliberate fixture diagnostics. Early runs exposed transient assertions and a probe assumption that the first Input group was Movement; the probe now locates groups by name. Both an isolated unchanged-HEAD baseline and the final worktree passed. No unresolved regression is being waived.
- `npm run lint:ts`, `npm run lint:dead`, changed-file Prettier checks, and `git diff --check`: passed. Settings contract/persistence/transport/presentation tests additionally passed (29 tests across four files; overlaps the focused count above).
- Quality review traced the settings-to-viewport policy, mouse-source-to-arbiter merge, frontend dispatch-to-host-to-core facing contract, presentation-facing-to-camera follow, and cancellation/async-lock boundaries. Keyboard utilities retain their original narrow contracts; Settings merges their keyboard results into complete input preferences. The review removed duplicate viewport/blur cancellation hooks and obsolete pointer maps, and initially found no remaining ownership or lifecycle issue. That review missed the physical-path discontinuity described below; separate camera and facing tests did not exercise their coupling.

Visual acceptance remains with the user: assess steering sensitivity, the existing rear-follow entry transition, and cursor restoration in ordinary play. No screenshots were inspected or visual acceptance performed by the agent.

### Follow-up: remove mouse Escape policy

The mouse-specific Escape context, keyboard dependency, stored handle, registration, and release helper were removed. Steering termination is shared by capture loss, capture refusal, and full gesture cancellation. Capture loss does not synthesize button releases or repeatedly reacquire lock; ordinary focus/modal/world cancellation still releases movement. The browser probe now checks game Escape delivery, continued MMB forward, preserved keyboard/chord/middle-button movement after capture loss, and retained forward movement after capture refusal. The removal reduced production code by 11 physical lines. Follow-up verification passed: `npm run check` (zero Svelte errors/warnings), `npm run lint:ts`, 42 focused input-policy/arbiter/dispatch/gate tests, and the updated mouse-movement probe in both Chrome and Electron (zero runtime errors). The runtime checks assert that Escape reaches normal game handling, MMB movement continues until release, capture loss leaves keyboard/middle/chord holds intact without re-locking, and capture refusal preserves forward while reporting its reason. Existing blur/pointer/modal cancellation and late-acquisition cleanup continue to pass. No Rust or shared movement contract changes were needed for this follow-up.

### Follow-up: integrate mouse yaw through ordinary physics

The user reported that steering collapsed the boom into the player. The coupled regression reproduced this before the fix: the first mouse turn reseeded the camera and reduced rendered reach to zero. Relative yaw had reused the absolute-facing snap helper, which rewrote the player pose before physical integration. That reset physical placement and broke continuity between the preceding camera target and the next published movement path. The boom then correctly invalidated its old path and initialized clearance at the player.

Relative yaw now enters the normal physical reference alongside authored root motion, preserving physical support and the preceding path endpoint. Idle bodies wake for this one-shot input. Linear actuation is selected before adding yaw, so a rotation-only reference cannot replace client-directed velocity. Pending yaw is consumed once when a physical interval is available. The simulation reports whether accepted facing changed, and the runtime publishes that accepted pose immediately afterward through the existing position sender. Absolute correction commands retain their snap semantics. Camera collision and reach policy are unchanged.

The regression runs the real grounded player simulation and boom together for 30 steering frames in each of three cases: idle, running forward, and simultaneous keyboard turning. It asserts continuous integrated paths, camera advancement without reseeding, reach above the configured minimum, and immediate publication of accepted relative facing. It uses checked-in test fixtures and no external runtime assets. Browser gesture fixtures alone cannot prove this physical integration.

Verification: all 691 core library tests passed; the host's all-target Clippy check passed with warnings denied; Rust formatting and diff whitespace checks passed. The restricted test run denied sockets for seven unrelated transport-dependent tests; rerunning the full suite outside that restriction passed. Visual acceptance remains with the user.

### Follow-up: vertical RMB camera pitch

RMB steering now splits pointer displacement by axis: horizontal motion remains a relative character-facing command; vertical motion adjusts camera pitch locally using the ordinary orbit sensitivity, sign, and pitch bounds. Both the threshold-crossing drag before pointer lock and locked relative movement use the same steering helper. Pitch-only movement emits no character turn.

The camera exposes a narrow pitch operation that preserves rear-follow entry and the rear pin. Ordinary orbit continues to release rear-follow. Releasing RMB preserves the selected pitch; no new setting, host command, physics path, or movement owner was added. Camera tests cover pitch changes during entry and while pinned, continued yaw following, and both pitch bounds. The mouse browser probe covers vertical input before pointer lock and pure vertical input while locked, including the absence of character yaw.

Verification: 11 focused camera/gesture tests passed, `npm run check` reported zero Svelte errors/warnings and passed all TypeScript checks, and TypeScript lint passed. The updated mouse probe passed in Chrome and Electron with `steeringPitch: true` and no runtime errors. Formatting and diff whitespace checks passed. User visual acceptance remains separate.

### Final code quality review

Reviewed the accumulated feature against HEAD, including untracked production files, tests, browser fixtures, persisted settings, and the shared checkbox style. The pre-existing ACE submodule change is outside this feature. No blocking findings remain in the reviewed paths.

Seams inspected: settings migration and keyboard-only binding edits preserve complete input preferences; viewport mouse edges enter the source-aware arbiter; bounded relative displacement shares the ordered drive/jump dispatch lane and is invalidated on cancellation; TypeScript and Rust host adapters retain signed radians and validate finite input; core admits relative yaw through physical integration, publishes accepted facing afterward, and retains continuous player paths for the boom; frontend pitch preserves rear-follow while ordinary orbit releases it. Lock refusal/loss, late acquisition, settings replacement, precise-mode transitions, focus/modal cancellation, and teardown were traced through their immediate consumers. Shared checkbox alignment remains in the existing UI primitive.

The review deliberately retained separate frontend dispatch and core accumulation because they own different lifetimes and cadences, and retained absolute-facing snaps for actual correction callers. The old absolute-facing log level was restored now that mouse yaw no longer uses that path. No temporary input tracing, file sink, diagnostic global, or mouse-specific Escape registration remains. Actual desktop-device event delivery is outside automated fixture coverage; the reported ThinkPad behavior was traced to brief delivered click pulses and the device's default button-scrolling policy. Visual acceptance remains with the user.

Final verification before commit: 691 core library tests, 147 focused TypeScript tests across twelve files, and 21 host contract tests passed. Full app type checks, TypeScript lint, dead-code lint, strict host Clippy, changed-file Prettier checks, Rust formatting, diff whitespace checks, and the final Chrome mouse-control probe passed. The Electron mouse probe also passed after the pitch change. No agent visual acceptance was performed.
