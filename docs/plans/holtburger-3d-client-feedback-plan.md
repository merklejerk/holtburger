# 3D Client Feedback Coverage

Status: **Feedback implementation complete, with recorded live-coverage limitations. Movement-cancellation follow-up implemented and verified below.**

## Objective

Surface server notices, popups, confirmations, sound cues, and the proven local use feedback in the
3D client without losing their meaning or mixing their lifetimes.

This plan builds on the existing selected-entity health/use wiring and action-result toasts. It does
not replace those changes. Implementation was subsequently authorized. Staging and commits remain unauthorized.

## Scope

In scope:

- Preserve server transient strings and popup strings as distinct core events.
- Route action-result text, server transient text, and local interaction notices into the existing
  app-owned notice presentation.
- Display popup text in an accessible, dismissible dialog, including messages received during login.
- Expose active character confirmations, recover them with replacement state, and respond to the
  exact displayed request.
- Deliver server `PlaySound` cues through the existing positional effects-audio implementation.
- Add the retail-proven local use and locked-container notices while continuing to send `Use`.
- Migrate the TUI's consumers when shared contracts change, preserving its existing feedback.

Out of scope:

- Vendor, container inventory, book, trade, and other full interaction interfaces.
- General interaction eligibility, pathfinding, automatic movement, or client-side rejection policy.
- A universal notification framework, persistent notification history, or guaranteed toast delivery.
- Changing server behavior or interpreting sounds as substitute server error messages.
- Modifying the retail decompile.

## Evidence and Ground Truth

### Server and retail behavior

- `ACE/Source/ACE.Server/WorldObjects/Door.cs::ActOnUse` sends
  `CommunicationTransientString("The door is locked!")` and `OpenFailDueToLock`. A locked door can
  still open from its back side; a generic local "locked means reject" rule would be wrong.
- `ACE/Source/ACE.Server/WorldObjects/Chest.cs::CheckUseRequirements` normally emits the lock-failure
  sound. Its extra transient text depends on `fix_chest_missing_inventory_window`, whose default is
  false in `ACE/Source/ACE.Server/Managers/PropertyManager.cs`.
- `ACE/Source/ACE.Server/WorldObjects/Player_Use.cs::TryUseItem` can send successful `UseDone` after
  activation was declined. Successful completion does not establish that a container opened.
- The live diagnostic attempt against chest `0x77D6405F` recorded a `Use` request and completed use
  with no error, without a container-open event or action-error message. Sound packets were not
  captured by that trace; its sound explanation came from source inspection.
- `acclient-eor-source/acclient.c:674814`: `CM_Inventory::Event_UseEvent` serializes the sequence
  header, opcode `0x0036`, and target GUID, then submits through `Proto_UI::SendToWeenie`.
- `acclient-eor-source/acclient.c:414515`: retail submits that wire request before calling local
  `CPlayerSystem::UsingItem` and emitting its use/approach notice.
- `acclient-eor-source/acclient.c:383278,383334,413232`: the local container path reaches
  `ItemHolder::AttemptSetGroundObject`; the cached Openable flag determines whether the container
  can be presented. Its locked message is not a server error response.
- `acclient-eor-source/acclient.c:404044`: transient strings feed the transient text display.
- `acclient-eor-source/acclient.c:406265,667781`: inspect the popup handler and dispatch before
  choosing exact popup behavior; preserve its distinction from transient text.
- `acclient-eor-source/acclient.c:137207,304920`: sound packets target an object's sound table;
  retail queues a packet if the source object is not yet available.
- `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventPopupString.cs` and its callers in
  `Managers/WorldManager.cs` and `WorldObjects/Managers/EmoteManager.cs` show login and scripted
  messages, not exclusively failures.

### Existing implementation

- `crates/holtburger-core/src/client/messages.rs` currently flattens both popup and transient strings
  into `ServerMessage`. It already converts ordinary server errors and failed `UseDone` into
  `ActionResult`; `PlaySound` has no corresponding core handling.
- `crates/holtburger-core/src/errors.rs` owns the shared action-result formatter.
- `crates/holtburger-core/src/client/types.rs` defines `ActiveCharacterConfirmation` and
  `ClientApplicationSnapshot`. Active confirmation is currently absent from that snapshot.
- `crates/holtburger-core/src/client/commands.rs::RespondToConfirmation` currently accepts only a
  boolean and answers whichever request is active when processed.
- `apps/holtburger-3d/host/src/client_projection.rs` already turns action results and busy-operation
  timeouts into typed action feedback. Completed busy-operation errors must not produce a second
  notice in addition to their action result.
- `src/client/client-toast-center.ts` owns latest-wins replacement and expiry; `ClientToastOverlay`
  renders status/warning notices. Paths in this paragraph are relative to `apps/holtburger-3d`.
- `src/explorer/ExplorerTexturePageModal.svelte` demonstrates native dialog focus and the existing
  viewport input gate. Reuse the pattern, not the Explorer-specific component.
- `src/lib/game/runtime/game-presentation-runtime.ts` already resolves sound-table keys, owns
  pending dynamic script cues, and connects behavior hooks to `AudioSystem`.
- `src/lib/game/systems/audio-system.ts` and `src/lib/assets/web-audio-device.ts` own effects volume,
  positional playback, probability, asset warmup, and voice lifetime.

## Constraints, Distribution, and Concessions

There are three distinct lifetimes:

| Input | Owner and lifetime |
| --- | --- |
| Notices and popup messages | App presentation state; notice expiry or explicit popup dismissal |
| Confirmation request | Core-owned pending interaction, mirrored by the app until resolved/replaced |
| Sound cue | Transient presentation event associated with the relevant entity/world lifetime |

Constraints:

- Core preserves game meaning; the host projects typed data; the frontend chooses presentation.
- Keep toast/dialog policy out of core and world. Keep sound playback out of the reactive UI graph.
- Modal visibility must not create/destroy the host connection or world presentation runtime.
- Use existing owners and remove obsolete flattening paths in the same cutover.
- Compute local interaction facts once against the command's target in the owning core/world layer.
  Consumers do not independently reconstruct eligibility or infer failure from missing UI effects.
- Never treat successful `UseDone` as proof that a chest opened.

Observed input shapes:

- Text can be parameterized, multi-line, informational, or an error. Login can publish several notices
  together; packet names containing "error" do not establish severity for every value.
- A popup may arrive before the world view mounts. A confirmation can be replaced while a response
  is in flight. Core currently models one active confirmation.
- A sound cue carries target GUID, sound-table key, and volume. It can precede source realization.
  Repeated cues may be intentional; sound playback also has authored probability and user muting.

Accepted concessions and decisions:

- Retain the current latest-wins toast policy initially. Surfacing every channel does not guarantee
  every brief notice remains visible. A visible stack is a separate product change.
- When one local use attempt produces both a generic progress notice and a specific locked-container
  notice, present the specific notice so the generic message cannot immediately overwrite it. This
  is an explicit app presentation choice, not a reason to suppress the wire command.
- Popups are explicitly dismissible and should not disappear on the toast timer. Establish their
  ordering/replacement policy from retail and actual callers in Phase 1; do not invent an arbitrary
  queue capacity now.
- Confirmations have no invented client timeout or default acceptance. Core/server transitions own
  whether a request remains answerable.
- Notices and sounds are not replayed from application snapshots. Active confirmations are.
- Do not add an unbounded or independent sound backlog. Determine existing delivery/recovery support
  before introducing buffering. Any stale-cue discard policy must be explicit and verifiable.

## Architecture

Text notices converge at the app boundary:

`wire or local action semantics -> core event -> typed host projection -> existing notice owner`

Popups use an app-owned message-dialog lifetime. Confirmations use the same small dialog/focus
primitive where useful, but their state and response identity remain distinct from popup dismissal.
Sounds flow through the imperative presentation session into existing sound-table/audio execution.
Do not merge these paths into a universal notification manager.

## Phase 1 — Prove Contracts and Cut Over Text Events

- [x] Inventory the feedback variants and their current consumers in protocol, core, TUI, and 3D.
  Include ordinary chat, errors, transient strings, popups, confirmations, and sound packets so every
  channel has an explicit destination or documented reason to remain outside this feature.
- [x] Verify retail popup dismissal/order and confirmation request/done behavior against ACE and the
  decompile. Record findings here before selecting queue or replacement behavior.
- [x] Introduce distinct core contracts for transient and popup text; remove their conversion into
  ordinary `ServerMessage`.
- [x] Migrate TUI consumers directly to the new contracts, preserving visible text without aliases or
  duplicate events.
- [x] Extend the 3D host, transport inventory, strict decoders, and lifecycle events.
- [x] Route transient text into the existing notice owner alongside action feedback. Preserve
  informational text without keyword-based error classification.

Acceptance:

- Synthetic wire messages produce distinguishable core and host events with unchanged text.
- A locked-door transient reaches a toast; ordinary server chat remains chat.
- Existing action errors and timeouts still display once through their established paths.
- TUI checks/tests demonstrate that the shared cutover does not hide its existing messages.

## Phase 2 — Popup and Confirmation Presentation

- [x] Add a focused app-local text dialog using native dialog semantics and the viewport input gate.
  Support long/multi-line content, keyboard dismissal where appropriate, and focus restoration.
- [x] Own popup presentation above the world-view component so login notices are visible.
- [x] Include active confirmation in core application snapshots and the narrow host current-state
  projection; deliver changes through the existing confirmation event.
- [x] Bind responses to the exact displayed request. Inspect whether the wire type/context pair is
  sufficient or whether core must also issue a local receipt identity for repeated requests. Carry
  the chosen identity in the contract and validate it in core before sending any response.
- [x] Migrate TUI response commands to that same contract; remove the boolean-only command shape.
- [x] Disable duplicate submission while a response is pending; keep transport failure visible and
  retain an answerable prompt when the response was not submitted.
- [x] Handle server cancellation, replacement, snapshot recovery, and session teardown. Do not clear
  an active confirmation merely because a presentation component remounts or a portal transition
  occurs; follow the actual core/server lifetime.
- [x] Define arbitration when a popup and confirmation coexist. Prefer one modal surface with
  explicit priority over nested focus traps, without turning requests into a generic message queue.

Acceptance:

- A pre-world popup is visible and dismissible; long content is usable.
- Accept and decline send the exact active wire request identity and decision.
- A delayed response to A cannot answer replacement request B, including repeated-context cases.
- Snapshot recovery reconstructs an active prompt; cancellation removes it; disconnect releases
  focus/input ownership and pending UI state.
- Modal input cannot also trigger movement or Interact underneath it.

## Phase 3 — Server Sound Delivery

- [x] Route decoded `PlaySound` into a core sound-cue contract with its source, table key, and volume.
  Reuse entity-generation admission patterns where applicable; do not invent entity identity in the
  frontend.
- [x] Trace the existing dynamic script-cue pending/admission paths and determine where sounds can
  reuse their delivery mechanics. Extract a common primitive only if both real consumers need it.
- [x] Add a typed host cue and imperative presentation-session delivery.
- [x] Resolve the key through the emitting entity's sound table, reuse candidate selection and the
  existing audio device, and apply packet volume according to the retail sound path.
- [x] Establish behavior for cues preceding entity arrival, asset preparation, source removal,
  replacement generations, portal/world reset, and disabled audio. Reuse existing warmup deadlines
  rather than creating another independent replay timer.
- [x] Keep audio observations distinguishable in existing diagnostics where needed to prove missing
  data versus intentional silence. Do not invent a toast error from a sound key.

Acceptance:

- A synthetic lock-failure cue resolves the expected table entry and reaches positional playback.
- Packet gain, authored probability, and effects-volume controls retain their intended roles.
- Tests prove the chosen source-not-ready policy and prevent a late cue from playing on a replacement
  entity/world. Intentional repeated cues are not deduplicated as state changes.
- Browser verification exercises the real audio path; live locked-door/chest checks corroborate it.

## Reassessment Before Local Interaction Feedback

- [x] Review whether all server-originated channels now have the intended destination.
- [x] Record unresolved delivery/lifecycle evidence and adjust remaining work before widening scope.
- [x] Confirm that the remaining chest notice is genuinely local feedback, not a missing server event.

## Phase 4 — Local Use Feedback

- [x] Trace the exact retail container predicate and use ordering, including exceptions in
  `AttemptSetGroundObject`. Limit implementation to behavior supported by those references.
- [x] Derive the applicable notice from authoritative cached entity facts in the shared command path;
  emit a typed semantic result rather than making the frontend inspect raw object bitfields.
- [x] Preserve the existing wire `Use` action and busy-operation behavior. Local locked-container
  knowledge provides feedback, not an early command rejection.
- [x] Feed the notice into the same app notice owner. Prefer the specific locked-container message
  over generic use progress under the accepted latest-wins policy.
- [x] Update TUI consumers as required by any shared event/command changes.

Acceptance:

- A locally known locked chest still sends `Use` and produces readable local feedback even when
  `UseDone` reports no error.
- The container rule does not reject a locked door that ACE permits opening from behind.
- A successful use without a supported inventory/vendor/book UI is not falsely labeled a failure.
- No sound packet is converted into a fabricated action error.

## Phase 5 — Cleanup and End-to-End Verification

- [x] Remove superseded flattening, duplicate formatting, unused event vocabulary, and temporary
  live-probe modifications. Preserve the existing user changes outside this plan.
- [x] Review each new owner, field, and abstraction against its named consumer. Reconsider added
  production lines when a direct adapter or shared existing path would suffice.
- [x] Use focused core/protocol/host tests for event mapping, confirmation identity, and sound
  delivery; use lightweight frontend tests for decoding and ownership transitions.
- [x] Extend `npm run harness:browser -- --client-hud --brief` for notices, popup focus, and
  confirmation lifecycle; add focused sound fixtures using existing harness capabilities.
- [x] Run app type checks, relevant TypeScript tests, ESLint, dead-code checks, formatting, and
  Clippy with warnings denied for affected Rust packages, including TUI migrations.
- [x] Verify representative live cases: locked door, locked chest, a popup, and an actual
  confirmation. Use synthetic evidence for cases unavailable on the local server and report that
  limitation explicitly. Do not run the interactive TUI for diagnostics.
- [x] Do not retain tests dependent on untracked runtime assets.

## Definition of Done

- Each in-scope server channel has an explicit typed path to its intended presentation.
- Local chest feedback works independently of server error messages.
- Core/world own game facts; the app owns notice/dialog policy; presentation owns audio playback.
- Confirmation recovery and response identity are proven, not assumed from UI timing.
- No modal or cue leaks across its intended lifetime, and no obsolete chat-flattening path survives.
- Required checks and browser verification pass; live evidence and any concessions are recorded.
- No files are staged or committed without a separate request.

## Decisions to Resolve During Implementation

These are evidence-gathering tasks, not reasons to pause before starting an authorized phase:

1. Retail popup order/replacement behavior and the smallest adequate app policy.
2. Whether confirmation type/context can repeat while an old UI response remains in flight.
3. How much of existing dynamic cue admission can be reused for source-not-yet-known sounds.
4. Whether generic use-progress notices justify their frequency once specific feedback is visible.

Toast stacking remains a separate product choice. Its omission is deliberate and must not be
misreported as guaranteed delivery of every transient notice.

## Execution Evidence

Phase 1 in progress:

- Cut over core popup/transient handling to distinct `PopupString` and `TransientString` events.
  TUI chat, scripting, combat feedback, and redraw routing retain their previous text consumption.
- Added separate typed host/transport/lifecycle paths. Transient text now enters the existing toast
  owner with status tone. Popup presentation remains Phase 2 work.
- Retail popup handler (`acclient.c:406265`) sets property `0xC3` to `1` and calls
  `DialogFactory::MakeDialogInCurrentUI`. `DialogFactory::MakeDialog` (`acclient.c:173093`) calls
  `CreateDialog_` immediately for that value, bypassing its other dialog queues. This proves an
  explicitly created dialog rather than timed transient text; dismissal and coexistence still need
  the rest of the dialog path inspected before choosing app arbitration.
- ACE `WorldObjects/Managers/ConfirmationManager.cs` assigns each request a per-player sequence
  context, validates type/context on response, and sends done on timeout. It admits simultaneous
  different confirmation types, while current core retains one active confirmation. The plan's
  existing single-active scope remains; replacement and session identity still need verification.
- Passed: `cargo check -p holtburger-core -p holtburger-cli -p holtburger-3d-host`;
  core wire regression `server_text_preserves_channel_and_verbatim_content`; app `npm run check`;
  lifecycle tests (12). Browser notice/dialog verification and remaining channel tests are pending.

Phases 1–2 decisions and verification:

- Channel inventory: ordinary speech/tells/channels/emotes/server chat retain the chat path;
  weenie errors, failed use, and busy timeouts retain action feedback; transient text uses notices;
  popup text uses dialogs; confirmation request/done use recoverable pending state. `PlaySound`
  remains the next missing channel. Existing combat feedback keeps its existing shared formatter.
- Retail `ConfirmationDialog::ListenToElementMessage` (`acclient.c:171623`) closes on either
  decision; `CancelDialog` (`171681`) supplies false. Confirmation done dispatches an abort notice
  (`384153`); gameplay checks both type and context (`269366`). Fellowship also closes on abort
  in the decompile (`192493`), despite ACE's comment claiming otherwise. Existing core cancellation
  behavior agrees with the decompile and remains in place.
- App policy uses one native modal: confirmations have priority, waiting popups are FIFO and survive
  until explicit dismissal or session exit. This is frontend arbitration, not a copy of retail's
  multiple immediate dialogs; no server-visible decision is invented.
- Added a process-monotonic core receipt per received confirmation. The host renders the full u64
  as decimal text; core validates that receipt before using the stored wire type/context. Repeated
  type/context pairs and different runtimes cannot accidentally alias receipts within the process.
- Added active confirmation to core and host snapshots. Core clears on leaving the character/session,
  retains across portal transitions, and publishes a replacement level after stale commands.
- Host invocation acknowledges command queueing. UI stays disabled until core's confirmation update;
  browser-to-host rejection retains the prompt with a retryable inline error. Server-send failure
  terminates the core runtime through its existing failure path, clearing the prompt on exit.
- TUI input and scripting now capture the displayed receipt. Existing TUI optimistic overlay dismissal
  remains frontend policy; no boolean-only core command survives.
- Browser verification caught native focus restoration failing after Svelte detached the dialog.
  The dialog now captures/restores the connected previous focus target during teardown. Rerun passed:
  pre-world popup, long scrolling text, confirmation priority, accept/decline receipts, duplicate
  suppression, waiting-popup preservation, focus restoration, and disconnect cleanup.
- Passed core confirmation tests (8 including the unrelated movement filter match), frontend dialog
  and lifecycle tests (16). Full lint/check sweep, broader TUI tests, and final live evidence remain
  Phase 5 work.

Phases 3–4 decisions and verification:

- Core now shares one `entity_cues` inbox for scripts and sounds, preserving interleaved order and
  the existing retail missing-object lifetime. Removal (including a missing placeholder deletion),
  world reset, and session exit retire pending entries. Sound projection carries source incarnation,
  world generation, table key, and packet volume; no snapshot replays these events.
- Presentation shares the existing per-entity readiness queue and preparation order. Sound arrival
  timestamps use the existing audio warmup allowance across owner construction, visual readiness,
  and decoding; late cues are discarded rather than playing when the player eventually returns.
  Missing table/key and expired pre-audio cues have distinct diagnostics; audio probability/muting
  continue to use existing AudioSystem counters. No separate replay timer was added.
- `acclient.c:366946` proves explicit packet volume replaces the sound-table candidate volume while
  retaining its probability. Already-playing sounds retain their sampled point; only cold replay
  checks source/world liveness. Disabled audio suppresses rather than stores a future sound.
- Tests exposed sound-table staging incorrectly conditional on a default physics script. Tables
  now stage independently in the entity's existing behavior-asset lifetime. The regression fixture
  intentionally has a table and no default script.
- Browser preparation also exposed `WebAudioDevice` returning immediately for a second concurrent
  prepare. A shared completion promise now honors the existing contract. Removed eager loading
  from `playOneShot`; AudioSystem owns warming after refusal. Byte accounting occurs before
  `decodeAudioData` detaches its input.
- Browser real-audio evidence (`/tmp/client-feedback-browser.log`): running AudioContext, generated
  1,644-byte PCM fixture, one decode, two cold triggers replayed. This proves the production
  AudioSystem/WebAudioDevice path; synthetic runtime tests separately prove entity table resolution,
  packet gain, probability, muting, early-source admission, incarnation rejection, and stale replay.
- Reassessment: server chat/action errors/transients/popups/confirmations/sounds all now have explicit
  destinations. A chest may still return successful UseDone with only a sound; its text is local.
- Retail local predicate: usable/non-targeted (`acclient.c:286680,286703,383329`), non-owned container,
  no Openable flag, and no creature type (`413232`, slot identified by `acclient.h:21281`, body at
  `418067`). Container means either capacity or RequiresPackSlot (`210543`); `statics.txt:9005`
  resolves IDA's `aActivationType` spelling to mask `0x00800000`.
- World owns these cached semantics in `interaction.rs`; core captures them for the command target
  and publishes only after sending Use. Existing busy admission remains unchanged. Generic progress
  stays enabled because a submitted action deserves immediate acknowledgement even before a server
  reply. Core formats progress/detail separately; the app prefers detail under latest-wins toasts;
  TUI chat retains both. Door-only objects do not inherit the container rule.
- Passed sound/core inbox tests (5); presentation/WebAudioDevice tests (37); world local-use tests
  (2); host local-use projection test. Full final suites and live cases remain below.

Phase 5 verification and startup review:

- Full affected Rust library suites passed: host 282, TUI 357, core 365, world 710.
  Focused frontend suites passed 259 tests across 23 files; Electron suites passed 25 tests.
  App type checks, ESLint, and dead-code checks passed. Clippy with warnings denied passed
  for all targets in core, world, host, and TUI after moving the shared formatter before its tests.
- Review found Electron launched the client before loading the renderer. That could lose login
  popups before the lifecycle listener set existed. The private launch now waits for the first
  `request_client_current_state`, which the lifecycle owner sends after installing its listeners.
  Concurrent/repeated snapshot requests await the same launch promise; startup credentials remain
  private and are cleared by the existing `startClient` boundary.
- A fresh real-client launch built successfully but ended with `client session ended` before live
  interaction verification. The configured local server ports are listening; a focused sidecar
  probe is investigating the actual login outcome. Live acceptance remains unproven.
- Follow-up live evidence: the focused sidecar probe reached character selection. A subsequent
  Electron launch reached character selection and then `in-world`; login action notices traversed
  the new listener-first launch path. The earlier disconnect was not reproduced on that attempt
  and its cause remains undetermined. The current character is in a dungeon with loaded doors but
  no loaded chest; the earlier Pathwarden chest GUID is not a current interaction target.
- Final browser HUD rerun passed, including real Web Audio cold loading and two replayed voices,
  popup/confirmation focus and dismissal, and feedback routing. A construction-stage sound test
  now proves expired sounds are pruned on further cue admission while fresh repeats survive.
- Live door attempts produced `Using the Door` action feedback. No lock-failure text or sound was
  captured for those attempts; they do not establish locked-door acceptance. Editing presentation
  code triggered HMR and explicit disconnect during observation, with an aggregate teardown error
  naming `presentation-owner`. The nested cause is not yet known. Temporary source logging was
  removed; a fresh browser-only diagnostic now expands nested errors without changing product code.
- The next live run ended with `attached entity 0x80005AB4 references missing ancestor
  0x50000003`, followed by a `runtime-failure` lifecycle transition. The error originates in
  `crates/holtburger-world/src/spatial/collision/selection_ray.rs`, whose attachment traversal is
  unchanged in this diff. This interrupts live interaction coverage and is distinct from the
  earlier HMR cleanup error. Do not interpret either interruption as a server lock response.
- Construction-stage sound tests passed (26 presentation-session tests), current app type/lint/
  dead-code checks passed, and formatting/diff checks passed after the final staging change.
- Controlled live HMR reproduced the cleanup failure and exposed the nested cause:
  `Cannot destroy ParticleEmitterInfo repository while 0x3200002f is referenced.` Runtime
  teardown destroyed the emitter/sound repositories before all dynamic residents released their
  asset handles. Moved dynamic-owner destruction ahead of those repositories. The same live HMR
  sequence then completed without a new cleanup error; runtime/dynamic-system suites passed
  75 tests. Temporary markup and diagnostic source logging were removed.


## Final Acceptance Audit

| Requirement | Inspected evidence and result |
| --- | --- |
| Distinct transient/popup contracts; ordinary chat retained | Core wire regression `server_text_preserves_channel_and_verbatim_content`, host projection test, transport inventories, and migrated TUI consumers. Passed. |
| Existing action errors/timeouts display without duplicate completion notices | Host feedback projection tests and browser HUD notice probe. Passed. |
| Pre-world popup, long content, focus, dismissal, and input ownership | Browser HUD `probeDialogs`: pre-world lifecycle, scroll bounds, native focus, input gate, confirmation priority, dismissal/focus restoration, and disconnect. Passed. |
| Confirmation identity, replacement, cancellation, recovery, and duplicate submission | Core receipt regression exercises repeated wire contexts and both decisions; command construction uses the receipt-matched stored wire type/context. Host preserves full u64 receipt as text. Dialog/lifecycle tests cover snapshots, remount, replacement, cancellation, transport rejection, portal retention, and teardown. Passed. |
| Entity sound admission and world/entity retirement | Core entity-cue tests exercise wire decoding, early source arrival, repeats, removal, and reset. Presentation/runtime tests cover world generations, source readiness, stale cue expiry, and cold replay cancellation. Passed. |
| Sound-table key, packet gain, authored probability, positional playback, and mute | Runtime sound fixtures plus real browser AudioSystem/WebAudioDevice probe (one cold load, two replayed voices). Passed. |
| Local chest feedback preserves Use; doors are not locally rejected | World predicate fixtures and core `locked_container_feedback_follows_use_without_suppressing_the_wire_command`; host notice projection. Passed. |
| Startup and teardown lifetime | Electron now launches after renderer listener installation. Live login reached in-world. Controlled live HMR exposed and then verified the asset-owner teardown-order fix; final diagnostic disconnect succeeded. |
| Shared cutover and quality gates | Affected Rust library suites: 1,714 passed. Focused frontend suite: 259 passed before the additional construction-stage regression; final presentation suite: 26 passed. Electron: 25 passed. Final runtime/dynamic suites: 75 passed. Type checks, ESLint, dead-code checks, formatting, diff checks, and affected all-target Clippy with warnings denied passed. |
| Cleanup | No temporary product logging/markup remains; no test depends on untracked runtime assets. Deleted script-only inbox is replaced by the shared entity-cue inbox. No staging or commits performed. |

### Live coverage and remaining limitations

Live verification established login delivery, ordinary door use notices, and corrected presentation
teardown. It did **not** establish locked-door/chest failure delivery, a server-authored popup, or an
actual server confirmation. The observed location had no chest loaded; door attempts did not emit
captured lock failures. One run was interrupted by the unchanged selection ancestry error
`attached entity 0x80005AB4 references missing ancestor 0x50000003`. Those specific feedback cases
use the synthetic wire/host/runtime/browser evidence above, as allowed by Phase 5's fallback;
they must not be represented as successful live tests.

The selection ancestry failure remains outside this feedback implementation. No error was swallowed
and no attachment, movement, or server behavior was changed to make the feedback checks pass.
Latest-wins notices and the existing single-active-confirmation model remain the accepted product
concessions. Missing full interaction interfaces remain out of scope.

The diagnostic launcher exited successfully after disconnect/window close. Commands arriving after
its core task stopped were rejected by the existing host command boundary; no additional asset
cleanup error appeared after the teardown-order fix. This does not claim a redesign of the general
control shutdown path.


## Follow-up — Cancel Server-Directed Interaction Movement

Status: **Implemented and verified.** This extends the original
plan's scope for movement cancellation only. The completed feedback acceptance record above remains
separate from this follow-up.

### Problem and intended behavior

Using a distant entity can make ACE direct the character toward it. Core retains and simulates that
approach, but manual drive replacement and Stop currently leave the server-directed motion active.
The approach continues taking priority over manual locomotion. A blocked character may never reach
its target or exceed the directive's failure distance, leaving the player unable to regain control.
The interaction busy timeout clears busy state, not movement ownership.

Deliberate movement, turning, jump initiation, or explicit Stop should cancel the approach and hand
control back to the player. The local transition and corresponding server notification belong to
core. The 3D client preserves input meaning and existing input priority. Wiring a gameplay Escape
key binding is deferred by user direction; the existing core Stop intent remains in scope.

### Ground truth and current paths

- `crates/holtburger-core/src/client/movement/system.rs`: `ingest_drive_command` updates manual
  drive/Stop without retiring `server_controlled_motion`; `advance_local_authored_motion` gives
  that directive priority. `should_send_stop_pulse` currently depends on locally tracked outgoing
  motion, and ordinary movement packets are deduplicated by previous intent.
- A temporary focused diagnostic confirmed that manual forward input and Stop both retain the
  server directive, and manual input does not become the active movement owner. The diagnostic
  was removed after the run.
- `crates/holtburger-world/src/motion/directed.rs`: translation completes by reaching the target
  and fails on target disappearance or exceeding the authored failure distance. It does not
  currently terminate because translation has stopped making progress.
- `crates/holtburger-core/src/client/runtime.rs::poll_busy_timeout` only retires the pending busy
  operation and publishes feedback; it does not cancel movement.
- `ACE/Source/ACE.Server/WorldObjects/Player_Move2.cs`: interaction approach uses
  `CreateMoveToChain2`; cancellation reaches the physics move-to manager.
- `ACE/Source/ACE.Server/WorldObjects/Player_Tick.cs::OnMoveToState_ServerMethod` applies raw
  movement with cancellation enabled. Inspect the client-method branch and sequence admission
  alongside it during implementation.
- `acclient-eor-source/acclient.c:330481` forwards the cancellation flag from raw to interpreted
  movement; `CommandInterpreter::StopCompletely` at `682023` invokes the player's stop path.
  Jump cancellation is also visible in ACE's `Physics/Animation/MotionInterp.cs`.
- ACE's `Physics/Managers/MoveToManager.cs::CheckProgressMade` and retail
  `acclient.c:331010,331769` track insufficient progress. The inspected references do not establish
  an automatic cancellation threshold: the failure counter has no identified consumer. Do not
  infer a timeout policy from the counter alone.
- `apps/holtburger-3d/src/client/ClientApp.svelte::handleWindowKeydown` and
  `client-input-arbiter.ts::applyCancel` currently give Escape a precise-jump cancellation role,
  with no ordinary gameplay movement-stop action.

### Investigation findings that change the design

The review followed the actual producer/consumer paths, rather than treating every drive update as
fresh player intent:

| Seam | Current behavior | Design consequence |
| --- | --- | --- |
| Browser controls → app | `CharacterInputController.applyAction` publishes drive snapshots for key changes. `reset()` also publishes a neutral drive, then a sequenced reset edge. `releaseOwnership()` publishes nothing. | A drive-shaped message alone does not establish deliberate takeover. Reset must not cancel an approach merely because its neutral snapshot arrives first. |
| App → host → core | `ClientApp.replaceClientDrive` uses the snapshot for camera translation intent, then serializes host calls through `inputDispatch`. `ClientDriveRequest.into_intent` maps every request to `ManualHeld`. | Preserve the distinction before the adapter loses it. If the redundant reset drive publication is removed, update its camera consumer explicitly. |
| Core command intake → movement tick | `process_command_batch` preserves FIFO, but `MovementSystem` splits commands into drive and character-event queues. Each tick processes all drives before jump/reset edges. | Unify ordered control intake; a jump/reset cannot be moved past a later takeover or Stop by queue category. |
| World/server admission → movement | `handle_server_controlled_movement` invokes separate note/set/clear/heartbeat operations immediately, while player commands await the next movement tick. | Server admission and queued input need one defined ordering rule. Earlier queued input must not accidentally reclaim control after a newer admitted server directive. |
| Movement → simulation | `active_drive` and `server_controlled_motion` can coexist. Authored-playback and local-drive query methods independently choose their precedence. | Represent the selected movement source once and have every execution query consume it. |
| Movement → wire | `server_motion_active` describes outgoing motion, not incoming server ownership; deduplication uses a separate last-intent value. | Retain publication history separately, with honest vocabulary. A required takeover notification cannot be inferred solely from that history. |
| TUI navigation → core | `navigation.rs::active_drive_command` repeatedly publishes autonomous updates; Stop also terminates navigation. | A controller continuation is not automatically a new user takeover. Audit this real shared consumer instead of making all non-neutral inputs cancel server movement. |
| Jump handling → movement | Stale edges return before mutation, but other results currently set manual ownership even when a release is rejected. | Select takeover at the proven jump transition, rather than granting it indiscriminately for every non-stale result. |

These are source-confirmed contract and ordering findings. The earlier temporary diagnostic proves
the manual/Stop ownership failure; this review does not claim live reproduction of every ordering
case. `CharacterMotionController` already has a focused held-drive/charge role and should remain.
The world-directed reducer and collision implementation also remain in their owning layers.

### Constraints, input patterns, and concessions

- Held controls, deliberate input edges, recurring controller updates, and server directives have
  different meanings. Preserve those meanings across adapters; do not infer takeover from a
  nonzero axis or from the mere presence of a message.
- One source selects the player's locomotion at a time. Input memory, jump state, the physical
  body, and the last command sent to the server have independent lifetimes and remain separate.
- No local override means authoritative world playback, not a physically idle character. Falling,
  animation, and forced position updates must continue to work.
- Manual authored movement and client-generated displacement retain their different execution
  mechanisms. Do not force both through one motion algorithm merely to unify control selection.
- World sequence admission remains authoritative. A genuinely newer server directive may take
  control; stale or duplicate packets must not revive a locally cancelled directive.
- No automatic stuck timeout, server patch, pathfinding rewrite, or general-purpose controller
  framework is included. Existing busy-operation lifetime remains distinct from movement control.

### Proposed transition contract

The following table is the behavioral contract to implement and test. Names describe semantics;
they do not mandate a new class for every concern.

| Event | Control and retained input | Required execution/publication consequence |
| --- | --- | --- |
| Admitted server approach/turn | Select the server directive. Keep held-input bookkeeping distinct from permission to execute it. | Retire the displaced local drive; invalidate superseded pending takeover effects. Preserve existing sequence and position-heartbeat rules. |
| Explicit manual movement/turn acquisition | Update held drive and select manual control, even when the supplied drive is neutral. | Retire approach/sticky pursuit and require the corresponding takeover movement packet even if its drive matches previous wire history. |
| Passive held-state synchronization | Update input memory without acquiring control. | No approach cancellation or takeover packet. When manual control already owns movement, its current drive must still remain coherent. |
| Jump initiation | Apply the established charge/input contract and take control at the retail-supported cancellation point. | Retire the approach and publish required takeover state; retain the existing physical jump commit and rejection rules. Stale/rejected follow-up events do not independently acquire control. |
| Explicit gameplay Stop | Select no local drive; clear pending movement/charge work that could immediately restart it. | Stop local approach playback and send the existing wire stop even when no previous manual packet was sent. Keep entity selection. |
| Focus/input-ownership reset | Release manual held input and charge. Preserve a server approach; this reset is not explicit gameplay Stop. | Stop a previously active manual drive as needed; do not send a new approach-cancellation pulse solely due to neutral reset bookkeeping. |
| Recurring client-controller update | Update that controller's drive while it owns control. | Do not let continuing navigation reclaim a server-directed or manually taken-over movement source. A new explicit controller start needs an intentional acquisition boundary. |
| Approach completes or fails | Retire that directive; do not implicitly resume a displaced controller or stale held drive. | Preserve existing terminal authored order and successful sticky-target semantics. Keep local completion distinct from server `UseDone`. |
| World-placement epoch retires | Clear selected control, queued input, and pending physical work for that epoch. | Preserve protocol ordering history where the connected session requires it; do not replay old input into the destination. |

Input ordering is part of this contract: reduce drive, jump, reset, Stop, and server-admission
transitions in their admitted order. Prefer a single narrow ordered control stream over parallel
queues or a new collection of suppression flags. Preserve the existing packet-scoped world authority
updates before entity-view publication. Any deferred control reduction must retain receipt-time
server target facts and must not publish an obsolete takeover effect after a later server admission.
Do not add a second protocol sequence scheme to solve an internal queue-order problem.

### Structural scope and ownership

1. **Preserve input intent at the boundary.** Remove the reset-as-manual-command ambiguity.
   First try removing its redundant drive submission and handling its actual consumers through the
   reset edge. Where real producers still need both passive synchronization and deliberate takeover
   (including held-input restoration), carry that distinction in a narrow typed input contract.
   Keep browser key names out of core. Explicit Stop is separate from passive reset. Update the
   host decoder, frontend lifecycle API, and actual TUI/harness consumers together where required.
2. **Consolidate active movement selection inside `MovementSystem`.** Replace independently active
   drive/directive fields with one composite choice: no local override, manual drive, client-directed
   drive, or server directive. Retain variant-specific data only on its variant. Keep held controls
   and jump charging in `CharacterMotionController`, and wire history separate. This is an internal
   state representation, not three new independent systems.
3. **Centralize transitions and their effects.** Unify ordered control intake and make admission,
   takeover, stop, completion, and epoch retirement own all associated state changes. Simulation
   queries read the chosen source rather than re-arbitrating precedence. Packet emission consumes
   the transition's notification requirement and records wire history after successful submission.
   Replace misleading outgoing-motion vocabulary. Remove suppression/reset machinery superseded by
   the new transition model, including the one-shot autonomous suppression workaround where the
   ordered ownership contract replaces it.
4. **Preserve frontend input boundaries.** Update the app/host adapters only as needed to carry
   deliberate input versus passive synchronization/reset. Retain existing dialog, editing, and
   precise-jump behavior. Do not add a gameplay Escape binding or a new host command solely to
   expose Stop. The existing core Stop intent and its current callers still receive the corrected
   cancellation behavior.

No new wire opcode is expected: use `MoveToState` with current sequence values. The first takeover
must survive deduplication; Stop must work after a server-only approach. Do not clear unrelated busy
operations or manufacture a server error as a shortcut. Shared control behavior belongs in core,
world motion/physics stays in world, and keyboard policy remains in the app.

### Implementation sequence and acceptance

Progress: drive, character-motion lifecycle events, and server admission now share ordered intake.
Server admission reduces immediately before view publication and invalidates earlier pending local
effects. `ActiveMovement` is the sole selected source; `PublishedMotion` separately records successful
wire publication. Manual acquisition and Stop retire a server directive and require notification
even when drive deduplication or absent outgoing history would otherwise suppress it. Passive core
reset preserves the directive, and held synchronization has its own semantic command. Input release
preserves lifecycle sequence history; only epoch retirement resets that history.

Focused movement tests pass (78 tests), including both orders of reset/drive and jump/Stop,
superseded queued input, same-drive takeover publication, server-only Stop publication, and passive
reset/synchronization. Frontend/host producer migration is implemented: drive requests carry
`acquire` or `synchronize` plus a shared drive snapshot; jump edges retain snapshot-only payloads.
Reset no longer submits a redundant drive command, and its camera consumer clears translation
intent explicitly. Precise-mode restoration uses passive synchronization. Frontend/Electron focused
tests pass (49 tests), host adapter tests pass (13 tests), and app type checks pass.
Controller acquisition/continuation is implemented through `ClientDirectedCommand`: acquire with
drive or initial facing, update, settle while retaining ownership, and release. Per-tick displacement
expires without discarding controller ownership. TUI explicit navigation starts and explicit melee Attack actions
acquire once; steering and settlement cannot reacquire after displacement by manual/server control.
The startup-facing suppression cache and core one-tick autonomous suppression flag are removed.
Full core (372) and CLI (357) unit tests pass after this cutover, including controller updates and
cleanup after displacement, plus idle controller ownership without repeated displacement.
The final acceptance record below supersedes these intermediate test counts.

Runtime evidence (local ACE, diagnostic Electron client): an unobstructed chest approach reached
use range normally. A distant door approach advanced down the corridor, and a semantic turn
acquisition interrupted it. At the blocked boundary, two successive samples held
`y = -75.479797` while approach animation continued; a CDP-delivered backward key press regained
movement away from the wall. A subsequent chest Use produced its normal lock feedback 7.108 seconds
after the door Use, before the ten-second busy timeout. Since core gates Use before emitting that
feedback and movement does not clear busy state, acceptance demonstrates server-driven completion
of the cancelled pending use. The analogous unblocked takeover/reuse test accepted the next Use
after 5.008 seconds. An earlier deliberately un-cancelled blocked approach timed out its busy
operation, as expected; movement control remained independently recoverable afterward.

Packet evidence: a focused test decodes actual captured session output and verifies the takeover
`MoveToState` opcode, current runtime pose, all four authority sequences, and neutral Stop versus
turning drive. ACE `Network/GameAction/Actions/GameActionMoveToState.cs` explicitly calls both
applicable move-chain cancellation paths before dispatching the movement formula. This establishes
cancellation independently of the optional fast-tick/client-formula branch.

Cleanup removed the redundant private drive-command enum; ordered intake now carries the public
semantic drive intent directly, with transient animation actions as a distinct stream variant.
Core tests passed (373) at that checkpoint. Diagnostic app disconnected after these trials.

- [x] Finalize producer mappings against the transition table, including key release, walk modifier,
  precise-mode held-input restoration, focus reset, TUI navigation start/continuation/stop, and
  jump rejection. Confirm the retail jump cancellation point before changing it. Record any
  evidence-driven table adjustment here; do not silently infer intent in an adapter.
- [x] Cut over input contracts and ordered core intake together. Prove `reset → drive`,
  `drive → reset`, `jump → Stop`, and `Stop → jump` retain their actual order. Prove a newer
  admitted server directive supersedes earlier queued takeover work and a later deliberate input
  can cancel it. Preserve existing world event publication ordering.
- [x] Implement the single active-control representation and centralized transition effects.
  Remove competing ownership fields and superseded suppression/reset vocabulary. Keep independent
  input memory, publication history, and physical jump facts independent.
- [x] Prove manual movement, turning, and explicit Stop interrupt an approach on the next applicable
  simulation step. Verify same-as-last-drive takeover still sends, server-only approach Stop sends,
  and stale/repeated input cannot emit duplicate cancellation or revive the directive.
- [x] Prove passive reset/synchronization, modal input, and continuing controller updates do not
  accidentally acquire control. Prove completion does not resume stale input. Verify valid newer
  server directives, successful approaches, jump outcomes, and epoch retirement.
- [x] Verify the revised input adapters preserve existing modal/editing/precise-jump priority.
  Verify local physics and the wire agree after deliberate movement takeover and existing core
  Stop, without adding an Escape binding or changing toast presentation or entity selection.
- [x] Verify interaction busy/completion behavior remains coherent after cancellation without
  conflating it with movement ownership.
- [x] Run focused core/world and frontend tests plus affected TUI/harness contract checks, types,
  lint, and Clippy. Use browser input verification and a live blocked/unblocked approach-and-cancel
  check to establish that ACE abandons the pending approach and player control remains usable.
  Do not run the interactive TUI.
- [x] Review the result for subtraction: control selection is derived once, transitions own their
  cleanup and notification, and no adapter reconstructs deliberate input from drive contents.
  Remove temporary diagnostics and record evidence/limitations. Do not stage or commit.

### Implementation decisions and boundary

The user clarified that core cancels on movement-command intent, not keyboard events. Explicit
acquisition takes control; passive held-state updates and controller continuations do not. This
resolves the implementation pause. Browser presses produce acquisition and releases produce
synchronization; core receives semantic intent without key names. In retail,
`acclient.c:681755` handles releases during server control through `NukeCommand` and returns before
`TakeControlFromServer` (`681765`, implementation at `681439`); `acclient.h:36051` confirms the
vtable identities. Releases still update the drive when manual control already owns movement.
Jump initiation passes through takeover before `MovePlayer_NonAutonomous` dispatches to
`CommenceJump` (`acclient.c:682148`), so cancellation does not depend on eventual jump success.
Escape wiring remains deferred.

Navigation producer audit: explicit approach/follow/scoot activation is distinct from recurring
steering. `drive_active` alone cannot identify acquisition: replacing a navigation target does not
necessarily clear it, and follow can settle then resume. Startup facing, arrival pose, temporary
settling, and final controller release must carry controller scope too; a delayed arrival/stop must
not disturb a newer manual/server source. The implementation should retain controller ownership
while its per-tick displacement is absent, and grant acquisition only at explicit navigation starts
or an explicit melee Attack action. Existing sticky-melee `navigation_request` is a recurring
desired-engagement projection, not an acquisition event. Final review moved acquisition to the
explicit Attack producer and added a test proving a projection gap cannot reacquire control.

The direction is a bounded structural refactor, not a helper added to every input handler. Exact
internal type names and whether a small publication record deserves extraction are implementation
choices; a new abstraction must remove existing coordination work. The navigation acquisition
boundary and jump cancellation point must be grounded before their producer mappings are finalized.

Manual takeover and explicit Stop eliminate the permanent inability to regain control. Automatic
termination of a stalled approach remains a separate policy investigation: the inspected progress
counter does not establish a cancellation threshold. No arbitrary timeout is included.

Scope clarification: gameplay Escape key wiring is deferred. This does not defer core Stop
semantics or the ability to regain control through deliberate movement input.


### Final acceptance record — movement follow-up

- **Input contract and priority:** typed host acquisition/synchronization, snapshot-only jump edges,
  reset-only release, camera reset, and passive precise-mode restoration are implemented. Focused
  frontend, lifecycle, modal/precise-input and Electron tests pass (162 tests). Full app/Svelte,
  test and Electron type checks, ESLint, Knip and Prettier checks pass.
- **Ordering and lifecycle:** core tests cover both reset/drive orders, both jump/Stop orders,
  server admission superseding queued input, later takeover, sequence-preserving Stop, and epoch
  retirement. The shared world's existing stale/duplicate server-sequence admission remains in
  place. Completion tests now begin with displaced manual input and verify it does not resume.
- **One active movement source:** every simulation query consumes `ActiveMovement`; held/charge
  state, pending physical jump and successful publication history retain their independent roles.
  Controller displacement expires per tick while ownership persists. Continuing updates, arrival
  and release cannot disturb a newer manual/server source. Explicit manual takeover retires pending
  controller arrival/facing work. The redundant internal drive enum and old suppression caches are
  removed. Existing world reducers, collision and manual/client-directed execution algorithms remain.
- **Wire and local cancellation:** captured packets verify the actual MoveToState action, runtime
  pose, authority sequences, and neutral Stop/turning payloads. Same-drive takeover bypasses ordinary
  deduplication; server-only Stop publishes even without prior outgoing motion. Unit and live checks
  establish local control restoration and server cancellation.
- **Live core Stop:** a temporary noninteractive harness observed ACE MoveToObject sequence 1,
  submitted core Stop after 800 ms, and received `BusyOperationFinished(Use, Completed { error: None })`
  99 ms later. It disconnected cleanly. The temporary harness source was removed.
- **Browser and ACE integration:** actual CDP keyboard input cancelled both approaching and blocked
  movement; subsequent Use was accepted before the busy timeout. Successful un-cancelled approach
  still reached use range. The deterministic browser HUD fixture completed successfully. Chrome
  emitted its background registration/zygote shutdown diagnostics, with no fixture failure.
- **Final checks:** host 283, CLI 358, core 375, world 710 unit tests pass. Clippy with warnings denied
  passes for core, CLI, host and debug harness; the final CLI producer refinement was retested and
  rechecked separately. `git diff --check` passes. No changes were staged or committed.
- **Boundaries retained:** no Escape binding, new wire opcode, automatic stuck timeout, server patch,
  pathfinding rewrite, or busy-state shortcut. A blocked approach may still time out its pending Use
  if left alone; deliberate movement or Stop independently restores control. Earlier feedback
  work and the separately recorded selection-ray crash remain outside this movement change.

The code-quality review traced browser controls → app → host → ordered core intake → simulation and
publication, plus explicit TUI navigation/Attack → recurring controller updates/settlement. The final
producer correction prevents combat snapshot availability from masquerading as explicit intent.
No remaining movement implementation or verification item is deferred.
