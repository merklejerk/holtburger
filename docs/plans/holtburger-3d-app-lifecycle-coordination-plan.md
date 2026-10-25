# H3D app lifecycle coordination

Status: implemented and verified. All four phases are complete. The source-grounded dry-run corrections, implementation decisions, and validation limits are recorded below.

## Context and boundaries

**Goal:** make every app lifecycle transition enforce the ordering, cancellation, and completion guarantees its dependents require.

This completes the existing coordination refactor. The app coordinator owns user intent and frontend admission; the session adapter owns authority observation; the presentation root owns renderer borrowers; Electron owns the window, persistence stores, and native process. Those responsibilities remain separate.

In scope:

- A reliable presentation retirement barrier for active, starting, and already-retiring gameplay work.
- Explicit Disconnect, Return followed by Disconnect, connection loss, failed commands, and interruption during world entry.
- Cancellation of listener installation and startup when their session owner stops.
- Separate Return and Disconnect admission in the gameplay HUD.
- Awaited renderer preparation before Quit, native window close, or application quit destroys the window.
- Focused unit tests, controlled browser interruption probes, and live Electron verification of the changed boundaries.

Out of scope:

- Reconnect, connection configuration, credential retention, or another login attempt.
- Changes to logout wire behavior, authoritative character retirement, portal reveal semantics, or gameplay features.
- A universal state machine spanning Rust, Electron, renderer resources, and UI.
- New crash recovery UX, a general IPC framework, settings format changes, or changes to Explorer shutdown policy.
- Visual redesign or agent-owned visual acceptance.

The final coordination/close path touches roughly twenty production files, exceeding the initial approximate dozen. Four focused helpers own local cancellation, native camera registration, the close acknowledgement contract, and native window close. HEAD-relative line counts also include earlier uncommitted lifecycle work, so they cannot isolate this plan’s net-line impact. The extra machinery addresses demonstrated cancellation and IPC races; existing composition teardown is reused rather than duplicated. This plan required no Rust or wire changes.

## Ground truth

Paths below are relative to the repository root. Review implementations and immediate callers together; existing tests are evidence, not the definition of correct behavior.

| Boundary | Primary references and existing patterns |
| --- | --- |
| App policy and admission | `apps/holtburger-3d/src/client/client-app-lifecycle.ts`, `ClientApp.svelte`, `ClientGameplayView.svelte`, `ClientSystemMenu.svelte` |
| Session startup and authority observation | `apps/holtburger-3d/src/client/client-lifecycle-session.ts`; `src/lib/game/runtime/dynamic-entity-session.ts`; `src/lib/host/electron-host-transport.ts` |
| Camera generation and retirement | `apps/holtburger-3d/src/lib/game/camera/client-camera-session.ts`, `possession-camera-controller.ts`; `src/client/client-gameplay-presentation.ts` |
| Actual renderer ownership | `apps/holtburger-3d/src/client/client-presentation-root.ts`, `client-pregame-backdrop.ts`; `src/lib/game/runtime/presentation-teardown.ts`, `scene-target.ts` |
| Renderer settings buffers | `apps/holtburger-3d/src/client/client-settings-persistence.ts`, `client-character-settings-owner.ts`, and the flush hook in `ClientApp.svelte` |
| Native close and persistence | `apps/holtburger-3d/electron/main.ts`, `preload.cts`, `host-protocol.ts`, `client-settings-store.ts`, `client-visual-cache-store.ts` |
| Authority termination and forwarding | `apps/holtburger-3d/host/src/client_runtime.rs`, `client_host.rs`, `client_projection.rs` |
| Authoritative logout and replacement baseline | `crates/holtburger-core/src/client/lifecycle.rs`, `messages.rs`, `runtime.rs` |
| Authoritative camera acceptance, receipt, and reset | `crates/holtburger-core/src/client/camera.rs`, `commands.rs`; receipt schema in `apps/holtburger-3d/src/client/client-host-contract.ts` |
| Server and retail references if behavior is disputed | `ACE/Source/ACE.Server/Network/Session.cs`; `acclient-eor-source/acclient.c`, including RequestLogOff/ExecuteLogOff citations already recorded in core |
| Existing end-to-end diagnostic surfaces | `apps/holtburger-3d/src/harness/browser/ClientPresentationHarness.svelte`, `pregame-gameplay-fixture.ts`; `scripts/client-presentation-probe.mjs`, `live-client-ui-probe.mjs` |

The read-only audit established these counterexamples against the current implementations:

1. Disconnect during Return bypasses the barrier: requested mode is already `pregame`, while camera retirement is still pending. A held-retirement probe reached host Disconnect before camera retirement completed.
2. Camera retirement after terminal connection loss still invokes `stop_client_camera` against ended authority.
3. Rejected Disconnect produces `gameplay → idle → gameplay`, while the page says “Client stopped.”
4. `setMode("idle")` resolves after a driver retirement failure. The coordinator can publish a clean completed Disconnect despite that failure. Idle also queues behind an unfinished driver startup instead of cancelling it.
5. Stopping during pending listener installation still launches authority and leaves 72 listeners installed when installation resumes.
6. An unload flush with one save in flight leaves the latest settings patch in renderer memory until that save resolves. Electron cannot flush that unreceived patch.
7. The HUD uses `canReturn` for both actions, disabling Disconnect during entry and portals despite the coordinator's separate `canDisconnect` decision.

An additional execution probe held the camera start command response, then stopped the camera. The outer start remained pending and the registration promise produced an unhandled rejection before the command response was released. Cancelling registration alone is therefore insufficient; command acknowledgement and registration receipt are separate waits with separate late-completion hazards.

A same-target replacement probe also installed the first registration's camera generation into the replacement's state, while the replacement waiter remained pending. The older start's `finally` clears the newer registration callbacks. Registration callbacks must belong to one attempt, and receipt ownership must survive local waiter cancellation; target matching alone does not provide request correlation.

### Constraints

- Return logs out the character and retains the authenticated connection. Disconnect ends the attempt. Quit closes the application.
- Native startup stays explicit and runs only after all required event listeners are installed. Credentials remain in Electron main.
- Requested page/mode never proves that a renderer borrower or host camera has retired.
- A successful retirement promise means the driver's mutable borrower work has completed or been invalidated, and known-generation camera stops have completed or been superseded by authority retirement. Already-issued native registration requests remain session-owned until their outcomes settle. Failure must be observable after all applicable cleanup has been attempted.
- Authority can end during any await. Terminal authority observation invalidates its capabilities immediately; subsequent local cleanup must not require a live authority.
- Retired startup work cannot install listeners, launch authority, publish facts, or mutate the next lifetime.
- Renderer cancellation does not wait for an already-issued native launch to complete. Native Disconnect/shutdown owns cancellation of that launch; waiting for it during renderer preparation would invert the shutdown dependency.
- Cancel pending startup before draining shutdown work, but retain an already-running authority observation until host-dependent gameplay retirement finishes. Cancelling startup and disposing the live authority observer are different lifetime operations.
- Shared renderer resources survive Return and ordinary presentation mode changes. Gameplay retirement does not wait for unrelated pregame content construction. Quit has a stronger contract: all renderer producers and borrowers must retire before acknowledgement, followed by their shared assets. A gameplay-only barrier cannot prove application close readiness.
- Session command completion and local cleanup completion are separate facts. Preserve the real server exit cause alongside any local cleanup failure.
- A local stop acknowledgement is not an authoritative exit event. Late authoritative terminal details may enrich a stopped app without reopening admission.
- App failure withdraws gameplay admission and requested gameplay mode. Late command completion cannot restart it.
- Close preparation permanently withdraws admission for that close attempt. A prepared or failed acknowledgement must not restore input while Electron finishes exiting.
- Rendering remains imperative. Only changed, cold lifecycle/readiness facts enter Svelte reactivity.

### Concessions

- A renderer crash or a renderer that never acknowledges close preparation cannot hold native shutdown forever. Electron may continue after a bounded preparation deadline, record failure, and attempt the existing native cleanup.
- Cleanup and persistence can fail. Attempt the remaining independent releases, retain diagnostics, and avoid reporting a successful save or clean retirement. Quit may finish with a failure exit code rather than trap the user in an unclosable window.
- The preparation deadline bounds the renderer handshake, not arbitrary filesystem I/O in existing native persistence code. Do not claim a total application shutdown bound without proving one.
- Native process crash UX remains unchanged in this scope. Ordinary connection loss still belongs in the app.

## North stars

1. Own the resource fact at the layer that can prove it. The app requests retirement; presentation proves it; authority observation determines whether host interaction is still possible.
2. Cancel or withdraw producers before awaiting their work. A queue of mode changes is insufficient cancellation.
3. Make the existing owners agree through narrow contracts. Do not introduce a parallel lifecycle dispatcher or another collection of UI flags.
4. Keep failure and cancellation distinct. Use owned lifetime/generation evidence for expected cancellation; never suppress errors by matching protocol error text.
5. Complete clean cutovers. Remove the phase-based teardown bypass, misleading barrier use, shared HUD admission flag, and fire-and-forget normal-close path.
6. Prove interrupted transitions with held operations. Happy-path counts and successful Return followed by pregame Disconnect do not prove direct in-game Disconnect.

## Contracts and flows

The following contracts describe responsibilities; final names should follow the existing modules.

```ts
// App-local presentation capability. It covers active and pending gameplay borrowers,
// including an earlier retirement whose active pointer has already been cleared.
interface GameplayRetirement {
  retireGameplay(): Promise<void>;
}

// Narrow Electron preparation acknowledgement. Failed preparation still allows native
// best-effort shutdown; the failure remains visible in diagnostics and exit status.
type ClosePreparation =
  | { kind: "prepared" }
  | { kind: "failed"; diagnostic: string };
```

`retireGameplay()` revokes pending gameplay admission, cancels owned gameplay startup, and joins the actual gameplay retirement. Repeated callers join the same retirement. It must be callable while mode is pregame/idle and while pregame resources are still loading. It must not wait on unrelated static construction. Ordinary `setMode()` remains presentation selection, not proof of resource retirement.

The barrier covers driver-owned work that can still mutate the borrowed runtime or submit host commands. Generation-fenced, non-cancellable shared reads may finish under their existing owner after driver retirement; observe their eventual rejection and reject their stale results. Do not require abort support from every asset query, detach mutable driver work without fencing it, or clear shared caches to simulate cancellation.

Local cancellation cannot retract an already-issued camera registration or invent its authority-assigned camera generation. Settle the cancelled local start promptly, while the session retains ownership of the native command and any late registration receipt. A stale receipt never reinstalls the driver: while camera-command admission is open, the session retires that exact stale generation; once Disconnect has begun or authority has ended, native authority retirement owns its release instead. `ClientLifecycleSession.disconnect()` closes that command admission before invoking native Disconnect, so a late receipt cannot enqueue camera stop into a host already closing. This is an I/O capability lifetime, not a synthetic authority phase or another UI coordinator.

The existing receipt contains player/entity identity and an authority-assigned camera generation, not a caller request ID. Do not treat matching target identity alone as proof that a receipt belongs to a replacement local start. Keep at most one unresolved native registration for the same target until its receipt or an authoritative camera-reset/terminal boundary settles ownership; cancellation of a local waiter does not create permission to overlap another indistinguishable registration. Use the existing ordered authority stream and reset behavior to prove this cutover. If that cannot be established without a wire change, surface the contract gap at the Phase 1 checkpoint rather than inventing correlation fields.

Retirement must first revoke new frame/input work and cancel pending camera registration, then drain camera synchronization and other owned work, finish the applicable camera stop, and release borrowed scene state. The current destruction order waits on pending work before cancelling camera registration; copying that order would preserve a cancellation dependency. Attach rejection handlers when promises are created, including the receipt promise while its command response is still pending. Join all relevant work to settlement even if one task fails; a first rejected `Promise.all` is not proof that its other tasks have drained. Keep a failed retirement observable to repeated barrier callers and final root destruction rather than losing it when the active-driver pointer is cleared.

The camera adapter consumes terminal authority observation from `ClientLifecycleSession`. It invalidates the current camera generation and pending registration before later cleanup can submit commands. Cleanup after authority loss releases local state. If a request was already in flight, its outcome must be reconciled against that retired generation and session command admission without disguising a genuine live-generation failure. Keep this outcome observed even if the local start/stop caller has already completed cancellation.

The app coordinator invokes retirement on every Disconnect; it does not inspect the requested mode to decide whether retirement is needed. It preserves separate authoritative exit and local teardown outcomes in the existing app result model. The terminal page consumes both: a clean explicit Disconnect stays clean; a real teardown failure remains visible; a server-provided disconnect reason is not overwritten by a generic local error.

Intent precedence is local to the app coordinator: Quit supersedes other user intents; Disconnect supersedes Enter and Return; terminal authority observation immediately invalidates host-dependent capabilities during any intent. Superseding an intent cancels its unissued stages and joins already-acquired cleanup. It does not wait for Enter/Return's normal success condition, issue a second Disconnect, or let an older `finally` clear the winning intent. Late results can contribute diagnostics but cannot restore admission. Do not implement this as an unbounded queue that makes Quit wait behind a stalled Enter or Return.

If startup was cancelled before authority launch, native Disconnect can complete without an authority exit event. Represent that as a completed local stop with no authoritative outcome. Once an authority has existed, retain its terminal observation through retirement and preserve its real cause. Remove the current synthetic `acceptExit(explicit-disconnect)` fallback; do not let a local completion permanently mask a later authoritative reason. Terminal admission stays absorbing even when its diagnostic outcome is enriched.

| Transition | Required sequence and completion |
| --- | --- |
| Startup | Install listeners → verify lifetime is current → explicitly launch authority → request replacement state. Every suspended stage observes cancellation. |
| Enter / portal | Preserve existing reveal semantics. Disconnect remains available and can cancel pending gameplay startup without waiting for the destination to become ready. |
| Return | Stop input → request character logout → react to authority retirement → retire gameplay → admit the replacement roster/backdrop. The connection remains alive. |
| Disconnect, including during Return | Withdraw input/admission → cancel and join actual gameplay retirement → attempt host Disconnect → combine authoritative and local outcomes. A local cleanup failure does not skip the host disconnect attempt. |
| Connection loss | Observe terminal authority → invalidate host-dependent capabilities → cancel/retire local presentation → preserve the terminal server reason and any independent cleanup failure. No new stop command is required from dead authority. |
| Command or startup failure | Withdraw input and gameplay mode → retire affected work → retain diagnostics and the ability to end the attempt. Clearing an operation guard cannot restore gameplay. |
| Quit / window close | Electron intercepts close → renderer withdraws producers, drains local work, and flushes renderer settings buffers → renderer acknowledges preparation → Electron flushes accepted settings/visual captures and shuts down the host → final exit. |

```mermaid
sequenceDiagram
    participant UI as App coordinator
    participant P as Presentation owner
    participant H as Host authority
    UI->>UI: Withdraw input and session actions
    UI->>P: retireGameplay()
    P->>P: Cancel pending startup; join active/retiring work
    Note over P,H: Camera stop only while authority is available
    P-->>UI: Completed or failed retirement
    UI->>H: Disconnect, including after local cleanup failure
    H-->>UI: Authoritative terminal outcome
    UI->>UI: Publish combined completed outcome
```

For close, Electron owns one idempotent close operation for the sole product window. Route the in-app Quit button, native window close, and `app.quit()` through it. Avoid a cycle where `before-quit` waits for a renderer acknowledgement after the window has already been destroyed. Authenticate preparation replies with the existing application-frame boundary and accept them only for the outstanding preparation. Repeated close requests join the same operation.

The main-owned sequence is:

1. Intercept the native close/quit event before window destruction. Join the existing close operation if one exists; otherwise start preparation and forbid new client launches. Recheck that launch cutoff after asynchronous waits such as `hostReady`, not just on IPC entry. Existing native launch requests remain owned by main and are cancelled by native Disconnect/shutdown later.
2. Deliver one preparation request through the client-only preload bridge. Preload retains a request that arrives before the app handler registers, then delivers it when registered. The same deadline covers registration and preparation. Renderer loss or context replacement fails the outstanding preparation; a late reply cannot revive it.
3. Renderer adopts the winning Quit intent, cancels unissued startup/command stages, and joins acquired gameplay retirement. Keep required authority observation alive through that retirement. Then close the session's camera-command admission and hand any already-issued native registrations/launch to the pending native shutdown before disposing observers. This local handoff sends no second native Disconnect and waits for no held native success reply. Invalidate character-settings hydration and other settings/capture producers before the final renderer flush, without discarding already-buffered patches.
4. Close composition-level producer admission and retire the complete presentation lifetime: stop frame-driven work, prevent reactive reconstruction, close preview admission, and join active/pending/already-retiring presentation borrowers before releasing shared assets. Reuse the existing composition teardown from both preparation and unmount through one retained completion; do not create competing teardown paths or conceal this release inside a settings-only callback. Initiate withdrawal of every borrower before awaiting any one borrower. Keep host/content IPC available while accepted work drains. Then flush user and character buffers to completion or reported failure while settings/cache IPC remains available. Independent preparation failures do not skip either flush. Acknowledge the combined result; never reset Quit admission to idle afterward.
5. On acknowledgement, explicit failure, or preparation timeout, seal renderer request admission before final native cleanup. This is the acceptance cutoff for settings/capture requests as well as gameplay/start requests. Already-accepted store work remains owned by main; later requests are explicitly refused and cannot extend a flush whose completion is being claimed. Camera commands remain usable during preparation, not after this cutoff.
6. Flush accepted settings/window-state work, close the visual cache, and shut down the host, attempting every independent native cleanup step. Then perform one guarded final exit. The old `before-quit` parallel cleanup must join this operation rather than run alongside preparation. Explorer keeps its existing route.

Use a named main-process renderer-preparation deadline, initially 5 seconds, tested through the exported policy rather than duplicated literals. Keep it distinct from the existing sidecar shutdown grace period. A missing/crashed renderer or failed preparation proceeds through the explicit failure path. Do not introduce a save/discard prompt or a second normal shutdown route.

## Phased implementation

### Phase 1 — Establish the presentation retirement contract

Deliverables: `client-presentation-root.ts`, `client-gameplay-presentation.ts`, `client-lifecycle-session.ts` for camera request ownership/admission, `src/lib/game/camera/client-camera-session.ts`, `possession-camera-controller.ts` if required, and colocated tests. Wire the new capability into `ClientApp.svelte` and replace its current `setMode("idle")` barrier call.

- [x] Inventory active-driver, startup, camera synchronization, pending-work, and already-retiring promises. Give each one a cancellation/retirement owner.
- [x] Implement one idempotent gameplay retirement barrier retained independently of the active-driver pointer and requested presentation mode.
- [x] Cancel pending gameplay startup before waiting for it. Reuse existing generation checks, scene invalidation, and cancellation primitives where they provide the required guarantee.
- [x] Cancel pending camera registration before draining synchronization; observe command-response and receipt promises from creation. Keep already-issued native requests session-owned after local cancellation; fence late receipts and retire a stale generation only while session camera-command admission permits it.
- [x] Close camera-command admission synchronously before native Disconnect dispatch. Terminal authority invalidation also closes it; neither path fabricates an authority lifecycle event.
- [x] Preserve receipt ownership across cancelled/replacement starts for the same target using the existing wire shape; never bind an old receipt to the new waiter merely because its target matches.
- [x] Make registration resolve/reject callbacks attempt-owned. An older start's catch/finally may release only its own attempt, never a replacement's callbacks.
- [x] Separate non-cancellable, generation-fenced shared reads from mutable borrower work. Observe detached read failures; fully settle or cancel work that can still publish into the borrowed runtime.
- [x] Prevent late driver startup/realization from mutating shared resources after retirement.
- [x] Invalidate camera generations and pending registration on terminal authority observation; distinguish local release from a live-authority stop request.
- [x] Preserve real retirement failures for the barrier caller after attempting all releases. Keep ordinary presentation error reporting coherent without double-reporting the same failure.
- [x] Preserve the shared renderer owner across Return. Do not abort root/static construction merely to stop gameplay.
- [x] Remove the requested-mode conditional around the coordinator's retirement call as part of the contract cutover.

Acceptance:

- Held gameplay retirement blocks host Disconnect even after requested mode becomes pregame or idle.
- Held gameplay startup can be cancelled and retired without releasing its normal-success gate.
- Held camera command response and held registration receipt each permit local cancellation without an unhandled rejection or later generation installation. Release each gate after retirement: the session stops an acknowledged stale generation only while still open; Disconnect/authority-ended paths send no late camera command.
- Same-target cancellation followed by replacement cannot attach the first request's receipt to the replacement, strand its waiter, or let an older finally clear its callbacks. An authoritative camera reset/terminal boundary releases obsolete registration ownership.
- Held unrelated pregame construction does not block Disconnect.
- Terminal authority loss followed by camera cleanup sends no new host camera command.
- Repeated retirement callers await the same completion; a failed release rejects the barrier after remaining cleanup attempts finish.
- Concurrent mode change, explicit barrier, and final root destruction share retirement ownership; no caller sees false success or admits a new driver after failed retirement.
- Existing Return/re-entry retains one world canvas and renderer owner.

Decisions/course corrections: record the actual cancellation primitive and any change to the driver startup signature here during implementation. If existing scene work cannot be cancelled within app-local ownership, stop and reassess the contract before adding timeouts or moving policy into Rust.

Phase 1 evidence: 113 tests passed across camera registration ownership, the real session/camera adapter, gameplay presentation, and presentation root. `npm run check` and `npm run lint:ts` passed. The client-presentation browser probe passed with `browserErrors: []`. Native registration attempts are serialized by the session; cancellation uses typed abort outcomes and per-waiter controllers without changing the wire schema. The root retains actual driver retirement separately from requested mode. The harness now holds actual empty-snapshot withdrawal as well as camera IPC, since authoritative logout implicitly retires the native camera. Native live verification remains in final integration.

### Phase 2 — Complete session transitions and cancellation

Deliverables: `client-app-lifecycle.ts`, `client-lifecycle-session.ts`, `src/lib/game/runtime/dynamic-entity-session.ts` if its independently owned subscription needs the cancellation fence, `ClientApp.svelte`, `ClientGameplayView.svelte`, `ClientSystemMenu.svelte`, and focused tests.

- [x] Cancel session startup across listener installation, explicit launch, and initial snapshot request. Dispose listeners that finish installing after cancellation.
- [x] Settle renderer startup cancellation locally without awaiting the native launch response; keep its eventual outcome observed and transfer outstanding native cancellation to Disconnect/shutdown.
- [x] Make app teardown await or invalidate outstanding startup so a stopped owner cannot launch or publish later. Keep the live authority observer available to camera retirement, then dispose it; do not detach it early as a substitute for cancelling pending startup.
- [x] Keep the native startup order and private credential boundary intact.
- [x] Model failure/termination so neither late command responses nor operation-guard release can restore gameplay mode.
- [x] Attempt host Disconnect even when local retirement fails; retain both outcomes without inventing a new authoritative exit cause.
- [x] Replace the synthetic explicit-exit fallback with distinct local completion and authoritative terminal observation. Permit diagnostic enrichment without reopening a stopped app.
- [x] Implement the stated intent precedence using the existing coordinator's owned operation/completion state. Enter/Return normal-success waits cannot block a superseding Disconnect or Quit.
- [x] Reconcile authority loss during input drain, camera retirement, entry, and logout against the same terminal lifetime.
- [x] Pass Return and Disconnect admission separately through the HUD, consuming the coordinator's existing decisions.
- [x] Replace or remove tests that protect the old phase-based bypass or a resolved mode-change promise as proof of retirement.

Acceptance:

- Stop during held listener installation leaves no listeners, launch, snapshot request, or later publication from that lifetime.
- Stop during an already-issued launch prevents all later renderer stages from publishing; the existing native shutdown path cancels or retires that launch.
- Hold the native launch response while cancelling locally: renderer cancellation completes, Disconnect/close can advance, and a late response cannot resume renderer startup.
- Rejected Disconnect leaves presentation idle and input withdrawn, with a diagnostic outcome; it does not construct another gameplay driver.
- Entry/portal permits Disconnect while Return remains unavailable.
- Disconnect during Return waits for the earlier gameplay retirement; repeated intents issue at most one host Disconnect.
- Hold Enter/Return command acknowledgement, then request Disconnect/close: the winning intent advances without releasing the older success gate, and late results cannot clear it.
- Deliver authoritative exit before and after local stop completion: both orders retain the real reason and keep gameplay withdrawn. Pre-launch cancellation needs no fabricated authority event.
- Ordinary Return still retains its authenticated transport and admits the fresh roster only when its presentation is ready.

Decisions/course corrections: record the chosen representation of authoritative exit plus local cleanup failure. Prefer extending the existing composite app result over additional independent flags.

### Steering checkpoint — Reassess the remaining close boundary

- [x] Re-run the interruption matrix for Phases 1–2 against actual adapters, not only fake coordinator dependencies.
- [x] Confirm the production file/line impact and remove obsolete paths before adding the close handshake.
- [x] Trace Phase 3 with settings save A held, settings patch B pending, startup still active, and authority already ended.
- [x] Confirm the same close operation can serve both window close and `app.quit()` without recursion or early destruction.
- [x] Record new evidence and adjust the remaining phase if necessary. Surface any required Rust/protocol change as a scope change before implementing it.

Phase 2 / steering evidence: 81 focused tests passed for coordinator intent precedence, session attachment, and dynamic-feed ownership. Type checks, TypeScript lint, and the browser lifecycle probe passed with no browser errors. Held native launch cancellation retains terminal observation without waiting for native success; stopped/late installers cannot damage a fresh attachment. The HUD consumes independent Return/Disconnect admission. Cleanup failures no longer skip native Disconnect, local stop completion is distinct from authoritative exit, and failed shutdown does not restart gameplay. The existing presentation teardown stack and native stores remain the close boundary's owners. The implementation now has a session-owned camera registration helper and a small frontend async-lifetime primitive; the complete cutover is likely to touch the mid-teens production files rather than the original approximate dozen. No Rust or wire changes are required.

### Phase 3 — Await renderer preparation before native close

Deliverables: `electron/main.ts`, `electron/preload.cts`, the client-only bridge in `src/lib/host/electron-host-transport.ts`, app coordinator/composition wiring, and Electron boundary tests. Extract a small app-local close helper only if it makes event ordering directly testable; do not build a general IPC lifecycle framework.

- [x] Install the renderer's preparation handler before normal interaction and unregister it with its app lifetime.
- [x] Buffer one early preparation request in preload until handler registration; cover this wait with the same main-owned deadline and fail it on renderer/context loss.
- [x] Have renderer preparation close admission, cancel startup, stop input, and retire gameplay while IPC and the host remain available. After known gameplay work retires, close session camera-command admission and hand unresolved native attempts to main's pending shutdown before disposing observers.
- [x] Unify the existing full composition teardown and close preparation behind one idempotent completion. Withdraw frame/root creation and preview admission synchronously, then join all presentation borrowers and release shared assets before acknowledging. Preserve the narrower gameplay-only barrier for Disconnect. Attempt settings/capture flushing even when presentation release fails.
- [x] Audit transitive retirement promises for full settlement, including preview replacement chains: a rejected earlier retirement must not let shared assets release while a later borrower is still pending. Replace fail-fast joining where it violates borrower lifetime guarantees.
- [x] Fence character-settings hydration before each post-await IPC dispatch as well as before publication. A retired load waiting on an earlier settings flush must not later start a new load during native shutdown.
- [x] Keep admission withdrawn after the preparation acknowledgement. Repeated preparation requests join its completion rather than clearing a generic operation guard back to idle.
- [x] Attempt independent flush/release steps even when another step fails; return one typed prepared/failed acknowledgement with preserved diagnostics.
- [x] Intercept in-app Quit, native window close, and application quit before destroying the renderer. Reuse one main-owned close promise and final-exit guard.
- [x] Keep settings/visual-cache IPC open until preparation finishes. Then flush accepted store work, close the visual cache, and shut down the host using existing ownership and bounded native retirement.
- [x] Quiesce late character-settings hydration and settings/capture producers before flushing. Seal main's renderer request admission at acknowledgement/failure/timeout before claiming completion of native store flushes.
- [x] Reject unissued native launch continuations after close starts, including continuations resuming after `hostReady`; keep already-issued native launch cleanup independent of renderer cancellation completion.
- [x] Handle unavailable renderer, stale/unexpected preparation reply, failed preparation, and preparation timeout explicitly. Preserve normal native cleanup after preparation failure and report failure exit status.
- [x] Remove fire-and-forget `beforeunload` flushing as the normal persistence guarantee. Unmount cleanup may reuse the same preparation owner; it must not compete with it.

Acceptance:

- With save A held and patch B buffered in the renderer, close does not destroy the window or finish its native persistence stage until B has crossed the IPC boundary and completed its flush.
- A character-settings load completing during preparation cannot enqueue a new patch after the acknowledged flush. Accepted captures flush; captures arriving after the native admission cutoff are explicitly refused.
- All three close entry points join one preparation and one host shutdown. In-app Quit uses the explicit client close bridge; do not assume DOM `window.close()` is intercepted by the native window close hook.
- Hold a preview retirement and static-content work during Quit: no prepared acknowledgement occurs until work drains or is invalidated; advancing frames or reactive callbacks afterward emits no new IPC. The same held unrelated static work still does not block Disconnect.
- Reject preview retirement A while retirement B remains held: shared assets stay alive until B settles, and the combined failure remains observable.
- Hold the character-settings pre-load flush, retire the character during Quit, then release the flush after preparation: no stale load request or patch is dispatched. Late already-issued loads cannot publish or enqueue saves.
- Quit during startup, entry, Return, Disconnect, and terminal error neither restarts resources nor requires commands from ended authority.
- A camera registration reply/receipt arriving between renderer acknowledgement and native shutdown cannot issue a new camera command. Pending native launch/registration does not keep renderer preparation waiting for its normal-success response.
- An unresponsive renderer reaches the explicit preparation deadline failure path; existing native cleanup still runs.
- Close before handler registration is delivered once on registration or reaches the same explicit deadline. Late acknowledgement after timeout/context loss is inert.
- Settings failure is reported and does not skip camera retirement or native cleanup. Accepted visual captures are flushed before their store closes.
- Explorer mode retains its existing close behavior and receives no client-only handshake requirement.

Decisions/course corrections:

- The main-owned helper is `electron/client-window-close.ts`; preload buffers early preparation and the acknowledgement seals main's renderer request admission. The in-app Quit button now uses explicit IPC because an earlier live trace showed DOM `window.close()` destroying the renderer before native preparation began. Native window-close and `app.quit()` entry points still need independent live proof.
- The concurrent settings-flush integration probe exposed a second flusher starting save B while another caller finished awaiting save A. Persistence now waits for quiescence rather than returning on the assumption that the previous in-flight save owned all remaining work. Preserve the held-A/buffered-B regression.
- The latest source dry run confirms that `ClientApp.svelte` preparation currently joins only gameplay retirement; full root, preview, and asset teardown remains in unmount cleanup. `ClientPresentationRoot.frame()` can still poll portal loading while idle. A prior live Return/re-entry → Disconnect → Quit run recorded a host request after main sealed admission. The specific command/producer has not yet been identified; locate it before claiming the whole-composition change fixes that observed request. Do not weaken the main cutoff or suppress the diagnostic.
- Preview retirement currently chains `Promise.all`, which can reject before another retained borrower settles. Whole-composition close must preserve failure while draining every borrower before shared asset release.
- Character-settings hydration checks its generation after the native load, but can resume from its initial persistence flush and dispatch that load after retirement. Add the pre-dispatch lifetime fence and exercise that precise interleaving.
- Normal Quit must drain accepted static/content work under its existing owner; it cannot use Disconnect's exemption for unrelated construction. If this reveals a dependency on native shutdown to finish normal renderer release, stop and reassess rather than making timeout the successful path.

An OS-forced process kill is outside the acknowledged-save guarantee. These findings extend the existing Phase 3 composition wiring and verification; no Rust or wire-contract change is proposed.


Phase 3 implementation evidence: close preparation now withdraws the entire mounted client composition through the same retained completion used by unmount. It closes root construction, frame polling, preview admission, session observation, settings hydration, and capture publication before acknowledgement; preview and root borrowers retire before shared assets. Settings flushing remains an independently attempted operation. The native helper keeps IPC available through preparation, seals it on acknowledgement/failure/deadline, and attempts all native cleanup. The production dependency order remains app-local; no Rust or wire changes were made for this plan.

Live verification used temporary probes and authorized `.dev.env` credentials with redacted reports: direct in-game Disconnect (`/tmp/h3d-live-current-direct-disconnect.log`), two Return/re-entry cycles then Disconnect/Quit (`/tmp/h3d-live-composition-return.log`), direct in-game Quit (`/tmp/h3d-live-direct-ingame-quit.log`), native window close (`/tmp/h3d-live-native-window-close.log`), and native `app.quit()` (`/tmp/h3d-live-native-app-quit.log`) all exited with code 0 and no renderer errors or native shutdown diagnostics. The prior post-cutoff request no longer reproduces on that live route; its historical command was not captured, so do not attribute it to a particular asset query. Whole-composition retirement is independently required by the inspected ownership graph.

The browser authority fixture now retains authentication progress coherently and explicitly publishes the subsequent roster when its connection gate releases. An intermediate verification run was invalidated by a recorded hot reload and deliberately stopped; the clean full run passed with `browserErrors: []` (`/tmp/h3d-lifecycle-final-browser.log`). The final extended run passed with `quitDuringPregameLoading: true`, `captureDrainedBeforeClose: true`, and `browserErrors: []` (`/tmp/h3d-lifecycle-static-close-browser.log`).

### Phase 4 — Cleanup and complete boundary verification

- [x] Remove the phase-based retirement bypass, misleading barrier uses, obsolete shared HUD admission, redundant shutdown booleans, and superseded normal-unload hooks.
- [x] Sweep names, comments, fixtures, and tests so each remaining promise describes its actual completion contract.
- [x] Audit every new retained field for its named consumer and every error/cancellation branch for a reaching scenario.
- [x] Ensure each transition has one app policy owner and each resource has one lifetime owner. Retain distinct native/authority/presentation responsibilities.
- [x] Add held-operation controls and strict post-termination command rejection to the existing browser fixture where required.
- [x] Run the matrix below through unit, browser, and live boundaries as appropriate; retain the specific evidence and limitations in this working plan.
- [x] Run code-quality review of the accumulated implementation and immediate adapters, including failure paths and new/untracked files.

Phase 4 review and final checks:

- Reviewed the coordinator, session attachment/command admission, native camera registration, camera adapter, gameplay retirement, root handoff/destruction, dynamic-feed subscription, settings persistence/hydration, visual capture staging, composition cleanup, client preload/bridge, native close helper, and immediate Electron callers. Reviewed the new/untracked contracts and tests along with changed callers. Earlier unrelated Rust/submodule modifications were preserved and are outside this plan's review boundary.
- Removed the requested-mode teardown bypass, shared HUD action gate, synthetic authoritative exit fallback, overwritten camera registration callbacks, and normal fire-and-forget unload save. Composition unmount and preparation share one retained teardown. The generic cancellation helper stays in frontend infrastructure; session-native registration remains client-owned.
- Accepted distinctions: requested UI mode versus proven resource retirement; authoritative exit versus local stop completion; a cancelled local waiter versus an already-issued native request. Combining these would recreate the observed races. No universal lifecycle dispatcher or wire correlation field was introduced.
- Final full TypeScript suite: 394 files / 3,528 tests passed (`/tmp/h3d-lifecycle-final-tests.log`). Two subsequently added real camera/session terminal-path regressions passed in the 12-test camera suite (`/tmp/h3d-lifecycle-terminal-camera.log`). Final test type check passed after those additions.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run build:electron:main` (including runtime import verification), and `git diff --check` passed. Changed/new frontend files were checked for formatting; the only reported file was formatted afterward. No lint ignore or diagnostic suppression was added.
- Both clean browser runs and the five independent live routes listed above passed. The extended browser probe rejects all post-preparation host requests and advances frames after acknowledgement, including release of held pregame content. Unit tests cover held preview replacement after prior teardown failure and late settings-load dispatch after retirement.
- Limits: visual acceptance remains with the user; OS-forced kill cannot guarantee acknowledged persistence. Native renderer failure/deadline and artificial interruption races are covered deterministically, rather than by crashing the live account repeatedly. No exhaustive live network-fault permutation is claimed. No tracked tests depend on local runtime assets, and temporary diagnostics remain outside the repository. The deliberately interrupted browser run's confirmed Chrome/Vite/content-host listeners were terminated after verification.

## Verification matrix

| Scenario | Required evidence | Current evidence / limits |
| --- | --- | --- |
| Startup listener installation held, then stop/close | No late listeners, launch, snapshot, or publication; unit and Electron close ordering tests.  Session tests hold installer 0 and 3; late disposers run and no launch/snapshot survives. Preload tests cover early preparation. |
| Native launch already pending, then stop/close | Renderer lifetime stays retired; native cancellation/cleanup still runs.  Session held-launch test cancels locally while retaining terminal observation; native shutdown remains main-owned. |
| Native launch response held during local cancellation | Local cancellation/preparation does not wait for that response before native shutdown can begin.  Session held-launch regression and camera command/receipt tests complete local cancellation before native response release. |
| Gameplay startup/entry held, then Disconnect | Startup cancelled before drain; exactly one host Disconnect; no late driver admission.  Root pending-start test and coordinator held-Enter test; browser direct Disconnect holds actual borrower withdrawal. |
| Camera command response or registration receipt held, then retirement | No unhandled rejection, blocked local cancellation, or late camera generation installation.  Registration helper tests plus real camera/session cancellation tests; no unhandled rejection or stale generation. |
| Cancelled camera registration followed by same-target replacement | Old receipt is never attributed to the replacement waiter; no assumed request ID or untracked native registration.  Session registration serialization and real camera replacement regression use the unchanged receipt schema. |
| Direct in-game Disconnect | Camera work retires before host shutdown; browser fixture rejects late commands; live Electron check.  Strict browser direct-Disconnect probe; live current direct-Disconnect log records no renderer/host errors and exit code 0. |
| Return followed by Disconnect while camera retirement is held | Host receives no Disconnect until the earlier retirement completes.  Root already-retiring regression plus browser held empty-snapshot withdrawal before host Disconnect. |
| Pregame static loading held, then Disconnect | Disconnect completes without releasing unrelated static loading.  Root held-static-construction test and coordinator pregame-loading Disconnect regression. |
| Network loss during gameplay/entry/Return/Disconnect | No new camera stop request after terminal authority; server reason retained; local cleanup completes.  Coordinator terminal-retirement tests, real camera/session terminal lifecycle and exit-event tests, browser gameplay loss. Other interruption states use the same absorbing terminal reducer and session capability closure; no exhaustive live network-fault matrix. |
| Retirement failure | Remaining cleanup and host Disconnect attempted; terminal diagnostic retains the local failure; no false clean success.  Coordinator failed-cleanup Disconnect test; root retained-failure tests; native cleanup-failure tests. |
| Concurrent Return handoff, explicit retirement barrier, and root destruction | One owned driver retirement and preserved failure outcome; no mutable borrower work escapes the barrier.  Root concurrent handoff/barrier/destroy tests retain one retirement and its original failure. |
| Host Disconnect rejection | Gameplay stays withdrawn; no new camera/driver creation.  Coordinator rejected-Disconnect regression proves idle presentation and withdrawn admission. |
| Authoritative exit races local stop acknowledgement | Real terminal reason wins in either delivery order without restoring admission; pre-launch cancellation fabricates no authority event.  Coordinator local-stop/late-authority enrichment and terminal-first cases; no synthetic exit fallback. |
| Quit with an in-flight save plus a newer buffered patch | Latest patch crosses IPC and flushes before window destruction.  Real persistence/coordinator/native-close integration holds save A and B separately before native cleanup. |
| Character settings hydration or capture publication completes during close | Producers are quiesced before acknowledgement; native acceptance cutoff precedes final store flush.  Character-owner delayed-load test; browser held capture staging; native admission helper seals acceptance before shutdown. |
| Quit with pending static/preview work and idle frame polling | Complete composition withdrawal before acknowledgement; strict post-ack IPC probe; borrower failure cannot release assets early.  Browser prepared-close request rejection and two subsequent frames passed; pending-static Quit case passed in the final extended browser run. Preview-owner held replacement plus failed prior retirement regression passes. |
| Retired character hydration suspended on persistence flush | Releasing the old flush starts no new native load; already-issued load completion cannot publish or save.  Character-owner retirement during held save regression proves no subsequent load; existing late-A-load test prevents stale publication. |
| Quit while a session action is pending; duplicate close requests | One preparation, no resource resurrection, one native shutdown.  Coordinator held Enter/Return Quit cases, issued Disconnect join, retained Quit completion; native duplicate-request and preload tests. Live direct in-game Quit passes. |
| Close before preparation handler registration, then late registration/reply | Buffered request is delivered once or reaches its deadline; stale replies cannot reopen completed close.  Actual preload VM tests buffer before registration and tolerate disposal/replacement; native deadline/context-loss tests reject stale acknowledgement. |
| Renderer missing/unresponsive; save failure | Explicit failure/timeout outcome and best-effort native cleanup; no success claim.  Native close helper tests missing/unresponsive renderer, malformed/failed preparation, and native cleanup failure; coordinator test still flushes after retirement failure. |
| Ordinary Return and re-entry | Same authenticated session and renderer owner; coherent playerless baseline; no reconnect.  Live two complete Return/re-entry cycles retain the authenticated session; browser asserts one world canvas and renderer owner. |

Commands from `apps/holtburger-3d`:

- Focused tests alongside each phase, then `npm run test:ts` for final integration.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`.
- `npm run build:electron:main`, including its runtime boundary verification.
- `npm run harness:browser -- --client-presentation --brief` with held startup/retirement and strict terminated-authority behavior.
- A focused live Electron lifecycle probe using `.dev.env` credentials without printing them. Exercise direct in-game Disconnect separately from Return then Disconnect, plus re-entry and normal Quit. Do not run the TUI.

Do not retain tests requiring untracked runtime assets. Keep deterministic unit/browser fixtures; use temporary live experiments or the existing diagnostic scripts. Visual acceptance remains with the user. If Rust changes become necessary after explicit scope reassessment, add the affected Cargo tests and clippy with warnings treated as errors.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Requested mode is mistaken for actual retirement again | The presentation owner retains and exposes the actual borrower retirement; hold that retirement across Return in tests. |
| Retirement waits on the startup it needs to cancel | Cancel the driver lifetime before joining its work; test without releasing the startup success gate. |
| Renderer preparation waits for a native launch that only later shutdown can cancel | Complete local cancellation independently; keep the native request observed and owned by main until Disconnect/shutdown. |
| Cleanup failure prevents host Disconnect | Attempt disconnect after local cleanup attempts, then aggregate outcomes without replacing the authority's cause. |
| Connection loss arrives during graceful retirement | Authority-owned terminal observation invalidates camera generations; classify cancellation from that ownership evidence. |
| Close acknowledgement depends on an already-destroyed window or closed IPC store | Intercept close first; keep renderer, host, and persistence acceptance alive until preparation finishes or explicitly fails. |
| A late producer publishes after the final settings flush | Invalidate renderer producers before flushing, then seal main's request admission before native cleanup takes its final write snapshot. |
| Camera registration rejects before its command response settles | Observe both promises from creation and test each held gate independently. |
| Main and renderer wait on each other during `app.quit()` | One idempotent main close owner, one preparation acknowledgement, and a guarded final exit path; test each native event entry. |
| A close deadline becomes a substitute for correct cancellation | Use it only for an unavailable/unresponsive renderer; ordinary retirement is proven by owned completion, not elapsed time. |
| Scope grows into a global lifecycle framework | Reuse existing owners and typed client-only bridge; reassess after Phase 2 and reject hypothetical consumers. |

## Definition of done

- [x] All audit counterexamples have deterministic regression coverage at their owning boundaries.
- [x] Every row in the verification matrix has recorded evidence or a precisely stated external validation limitation.
- [x] Presentation retirement is independent of page/requested mode, cancellable during startup, idempotent, and honest about failure.
- [x] Stopped startup cannot launch or publish later; ended authority requires no new camera command for local retirement.
- [x] App failure and late command completion cannot restore gameplay.
- [x] Return and Disconnect consume separate admission facts; normal Return/re-entry behavior is preserved.
- [x] Normal Quit/native close awaits complete renderer composition retirement and persistence; no producer dispatches after the preparation acknowledgement. Failed/unresponsive preparation follows the explicit native fallback.
- [x] Type checks, relevant tests, lint/dead-code analysis, Electron build/runtime checks, and browser lifecycle verification pass.
- [x] Live direct in-game Disconnect, Return/re-entry, and Quit are verified independently, with credentials redacted.
- [x] Cleanup and accumulated code-quality review are complete; no parallel superseded lifecycle route remains.

## Open questions

No user decision currently blocks implementation. The working close policy is: wait for renderer preparation, then proceed with native best-effort shutdown on explicit failure or the 5-second preparation deadline, reporting failure rather than adding a save/discard prompt. No additional product-policy decision is needed for the dry-run corrections above.

Implementation discoveries and acceptance evidence belong in the relevant phase above. This is a temporary working plan, not a new durable architecture specification.

## Final diff review — 2026-10-25

Verdict: ready within the reviewed lifecycle scope after two focused corrections.

The review covered the accumulated diff against HEAD, including new/untracked files, the removed UI lifecycle reducer, shared Rust logout/character retirement, host startup/termination and projection, renderer intent/admission and resource ownership, Electron startup/close/persistence boundaries, and immediate UI/harness callers. ACE and ACViewer submodule changes are unrelated and excluded from the commit.

Findings resolved before commit:

1. Native `ClientHostRuntime::start` reset `accepting` to true even after pre-launch Disconnect had closed it. Startup now rejects closed admission before content or socket construction, and no longer resets that fact. The new native regression verifies that a retired attempt neither starts nor publishes.
2. `ClientApp` cached presentation retirement before its synchronous controller releases ran. A thrown controller release could bypass the returned completion, allowing later callers to observe false success. Controller releases now run inside the existing teardown stack, preserving failure in the shared completion and allowing remaining presentation releases and settings flush to proceed. No additional teardown owner was introduced.

The worker-stack regression remains with the private synthetic content-bootstrap fixture; relocating it would require exposing additional test-only access. Distinct app intent, native command ownership, authoritative exit, and presentation retirement remain separate because they have different completion conditions. The review added no reconnect behavior or wire change.

Final verification: 3,530 TypeScript tests passed; 2,085 Rust tests passed across host/core/world (three existing ignored tests). Type checking, TypeScript lint, Rust formatting, clippy for host/core/world with warnings denied, and diff whitespace checks passed. The browser lifecycle probe passed with no browser errors, including held pregame-content close and post-preparation request rejection. The sandboxed Rust test attempt could not bind its loopback socket; rerunning with loopback access passed. Prior Electron build/runtime, dead-code, and independent live-route evidence remains recorded above.
