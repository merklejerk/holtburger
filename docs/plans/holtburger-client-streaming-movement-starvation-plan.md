# Holtburger Client Streaming Movement Starvation Plan

Status: **Complete (2026-08-31).**

Origin: client-mode reproduction beginning with `@tele 21.7s 2.2w`, turning east, and running across
the `0x7c64` to `0x7d64` outdoor landblock boundary.

## Context and Boundaries

### Goal

Keep accepted client movement presentation current while newly visible dynamic entities realize
their visual resources during landblock streaming.

### Why this cutover is deserved

`ClientPresentationSession` currently sends synchronous placement ticks and asynchronous dynamic
visual realization through one promise FIFO. When outdoor interest crosses into a populated
landblock, a burst of entity upserts starts setup/model/texture preparation. Every later player tick
waits for those unrelated promises even though `GamePresentationRuntime.applyDynamicEntityTick()`
is synchronous and explicitly performs no visual realization.

The camera consumes its host paths directly through `ClientCameraSession`, outside that FIFO. It
therefore continues moving while the controlled player's last placement path expires. Animation
also continues independently, producing the observed running-in-place player. When the FIFO drains,
many stale placement paths apply between browser frames and the player visibly pops to the camera.

The shared presentation runtime already contains the concurrency mechanisms the client needs:

- upsert and snapshot methods accept desired entity records synchronously before their first await;
- one desired record owns and deduplicates its in-flight realization promise;
- generation and desired-record identity checks prevent superseded work from publishing;
- removal invalidates pending work before it can commit;
- late realization applies the record's latest accepted entity level; and
- runtime destruction awaits tracked realization continuations.

Explorer already applies dynamic ticks immediately while tracking upsert/snapshot realization
promises independently. The default implementation direction is therefore to delete the client's
redundant global mutation FIFO and use the existing runtime contracts, not to add a second scheduler
or worker system.

### In scope

- Remove asynchronous dynamic visual realization from the ordering path used by accepted placement
  ticks in `ClientPresentationSession`.
- Apply accepted tick batches synchronously at their actual renderer receipt time.
- Preserve synchronous desired-state acceptance before later events for the same GUID are handled.
- Preserve generation, removal, attachment-parent, residency, portal activation, error-reporting,
  and shutdown guarantees while realization remains in flight.
- Simplify other synchronous users of the same global queue where its removal makes serialization
  unnecessary.
- Add focused tests for ticks during unresolved visual loads, supersession/removal during loads, and
  portal convergence.
- Re-run the exact eastbound live-client route across the `0x7c64`/`0x7d64` boundary with cold and
  warm content caches.
- Use temporary timing diagnostics where needed and remove them before completion.

### Out of scope

- Changing host simulation cadence, movement integration, collision, camera solving, or IPC
  framing/buffering.
- Changing landblock ownership, scene-anchor, reanchoring, or coordinate conversion behavior.
- Hiding the symptom with player/camera interpolation, extrapolation, teleport thresholds, or a
  larger path buffer.
- Reducing scene-interest radii or suppressing newly visible entities to reduce the workload.
- Adding worker-thread presentation, an ECS, a general job scheduler, or unbounded parallel asset
  preparation.
- Reworking static terrain/object streaming unless implementation evidence shows it independently
  blocks accepted dynamic placement after the client FIFO is removed.
- Modifying protocol, session, world, ACE, ACViewer, or retail-decompile code. This is a frontend
  presentation scheduling defect; no retail-observable behavior question is currently unresolved.
- Retaining production counters, queue timers, browser globals, or route-specific debug UI.

## Ground Truth

### Runtime contracts

- `apps/holtburger-3d/src/client/client-presentation-session.ts`
  - `#receiveDynamic()` currently routes tick, upsert, removal, and snapshot work.
  - `#enqueueMutation()` creates the global FIFO responsible for the starvation.
  - `#requestDynamicSnapshotReplacement()` and
    `#requestDynamicEligibilityReevaluation()` currently inherit that FIFO.
- `apps/holtburger-3d/src/lib/game/runtime/game-presentation-runtime.ts`
  - `replaceDynamicEntitySnapshot()` synchronously replaces desired records before awaiting
    eligibility realization.
  - `upsertDynamicEntity()` synchronously calls `#acceptDesiredDynamicEntity()` before awaiting the
    record's realization.
  - `#realizeAcceptedDynamicEntity()` deduplicates realization per desired record.
  - `#realizeDynamicEntity()` rechecks desired-record identity after each asynchronous boundary and
    applies the latest record level at commit.
  - `removeDynamicEntity()` invalidates exact generations synchronously.
  - `applyDynamicEntityTick()` updates desired and installed state without asynchronous realization.
  - `destroy()` waits for tracked realization continuations.
- `apps/holtburger-3d/src/lib/game/systems/dynamic-entity-placement-system.ts`
  - `applyPath()` immediately replaces a root's active path.
  - `advance()` removes a completed path, leaving the entity at its last endpoint until another path
    arrives.
- `apps/holtburger-3d/src/lib/game/camera/client-camera-session.ts`
  - Camera events are received and placed into bounded playback directly, independently of dynamic
    visual realization.
- `apps/holtburger-3d/src/lib/game/runtime/dynamic-entity-session.ts` and
  `dynamic-entity-feed.ts`
  - The mirror has already validated hydration and generation ordering before presentation receives
    an accepted event.

### Existing patterns

- `apps/holtburger-3d/src/explorer/ExplorerApp.svelte::acceptDynamicEntityEvent()` applies tick
  batches synchronously and tracks upsert/snapshot realization promises without placing ticks behind
  those promises.
- `apps/holtburger-3d/src/lib/game/runtime/game-presentation-runtime.test.ts` already covers stale
  snapshot completion, superseded generations sharing a visual load, attachment ordering, and
  removal behavior.
- `apps/holtburger-3d/src/client/client-presentation-session.test.ts` already covers accepted delta
  forwarding, mirror recovery, portal readiness, and presentation teardown.
- `apps/holtburger-3d/scripts/live-client-ui-probe.mjs` is the canonical Electron/CDP route for
  automating login, teleport, input, renderer evidence, and redacted reporting.
- `docs/plans/holtburger-client-dynamic-delta-and-solver-epoch-plan.md` established the prior clean
  cutover from whole-mirror reconciliation to semantic dynamic deltas. This plan is a focused
  follow-up at the remaining asynchronous scheduling seam.

### Investigation evidence

The 2026-08-31 captures used the local ACE server and test administrator account. All temporary
instrumentation was removed after diagnosis.

- A near-due-east run began in landblock `0x7c640000` at canonical world X `23940` and crossed into
  `0x7d640000` at X `24000`, approximately 60 metres from the teleport destination.
- Player authority coordinates crossed the boundary continuously. No discontinuity or invalid
  coordinate conversion was observed.
- The camera remained in one camera generation and continued receiving ordered advanced paths. One
  35-second capture received 1,231 camera paths through the crossing.
- Dynamic visual realization introduced bursts of pending upserts at the boundary.
- Accepted dynamic ticks waited as long as approximately 1.38 seconds in the client mutation FIFO,
  with more than 60 mutations pending.
- A warmer repeated crossing still produced an individual 186 ms upsert realization with 13
  pending operations, demonstrating cache sensitivity consistent with the symptom's intermittent
  duration.
- Once the queue drained, delayed tick operations completed synchronously in a burst. This matches
  the player holding its last path endpoint, continuing its run animation, and then popping forward.
- Host-to-Electron-to-renderer delivery remained active for camera and dynamic events. Broad IPC
  starvation and scene-anchor failure are rejected by the evidence; landblock streaming is the
  trigger, while client-side realization serialization is the cause.

## North Stars

1. Accepted authority state is cheap and immediate; visual readiness is asynchronous and
   subordinate.
2. A slow or absent visual may delay appearance, never the latest placement of an installed visual.
3. Preserve event ordering through synchronous desired-state mutation, not through awaiting
   unrelated resource completion.
4. Reuse the runtime's existing generation and continuation ownership instead of adding another
   scheduler.
5. Portal reveal may wait for required destination realization; ordinary in-world movement may not.
6. Failures remain loud and generation-current without becoming unhandled promise rejections.
7. The repair should remove more scheduling machinery than it adds.
8. Verification must cross the real streaming boundary; a steady scene cannot prove this fix.

## Settled Direction Decisions

### D1. Delete the client-wide mutation FIFO by default

Remove `ClientPresentationSession.#mutationQueue` and `#enqueueMutation()` unless Phase 1 exposes a
specific invariant that cannot be expressed by the runtime's existing desired-record ownership.

Route accepted events as follows:

- tick: apply synchronously;
- upsert: invoke immediately so desired-state acceptance runs synchronously, then observe the
  returned realization promise independently;
- removal: apply synchronously;
- snapshot: invoke immediately and await only at call sites that genuinely own a hydration or portal
  convergence barrier; and
- server-time/discontinuity synchronous mutations: apply directly.

Do not replace the FIFO with separate named “hot” and “cold” queue classes. The runtime already owns
the cold continuations, and JavaScript event dispatch supplies synchronous ordering up to the first
await.

### D2. Keep the runtime API unless a failing test proves it dishonest

`upsertDynamicEntity()` and `replaceDynamicEntitySnapshot()` are `async`, but both mutate desired
state before their first await. Calling either method therefore establishes the accepted level
before the next host event callback runs. The returned promise names realization completion, not
authority acceptance.

Phase 1 must encode this property in tests. If it proves too implicit or a required caller cannot
use it safely, split the API into an explicitly synchronous acceptance method and a separately named
realization completion. That is a gated course correction, not the initial design. Do not add a
receipt type whose only consumer immediately unwraps its promise.

### D3. Use the actual event receipt instant

Capture `performance.now()` at the beginning of the accepted tick handler and pass that value to
`applyDynamicEntityTick()`. Do not compute a value named `receivedAtMs` inside a delayed callback.
After the FIFO removal both points should be close, but the contract must remain honest if later
work is inserted around dispatch.

### D4. Portal convergence remains an explicit barrier

Initial hydration and portal reveal are allowed to await destination realization because the client
must not reveal a partial destination frame. Preserve the existing activation receipt and
`PortalSceneActivation` identity checks. An older realization completion must not mark a newer
activation ready.

This barrier is scoped to portal presentation. It must not serialize later in-world deltas after the
destination is revealed.

### D5. Promise failures remain observed without ordering later ticks

Every fire-and-observe realization promise must attach rejection handling immediately. Reuse a small
session-local helper only if it has multiple honest callers and owns error reporting—not scheduling,
coalescing, or lifecycle state.

Runtime destruction remains the completion barrier for runtime-owned realization continuations.
Do not add a duplicate session set of every in-flight visual promise unless a teardown test proves
the runtime contract insufficient.

### D6. No permanent timing budget or diagnostic field

The regression is structural: unresolved visual promises must not prevent tick application. Unit
tests should assert that ordering directly. Live verification may temporarily record queue delay,
authority placement, presented placement, camera generation, and landblock transitions, but those
probes are removed during cleanup.

Do not codify one machine's asset-load duration as a production threshold. The live acceptance is
that movement remains current while realization is intentionally or naturally slow.

## Phased Implementation

### Phase 1: Encode the concurrency contract

#### Deliverables

- Extend `client-presentation-session.test.ts` with a fake runtime whose upsert or snapshot
  realization promise remains unresolved while a later tick arrives.
- Extend `game-presentation-runtime.test.ts` with a delayed visual source proving that a tick accepted
  during realization becomes the level installed when that realization completes.
- Cover exact removal and generation supersession while the same visual preparation remains in
  flight where existing coverage does not already exercise the ordinary upsert path.

#### Task checklist

- [x] Emit an upsert whose returned promise is deliberately held.
- [x] Emit a later tick before releasing the promise.
- [x] Assert the tick reaches `applyDynamicEntityTick()` before visual completion.
- [x] Assert tick receipt time is captured when the event is handled, not when visual completion
      resolves.
- [x] Resolve the visual and assert the installed entity uses the latest accepted placement and
      presentation level.
- [x] Remove or supersede a pending generation and assert its late continuation cannot publish.
- [x] Preserve the existing mirror-recovery rule that rejects deltas while awaiting a replacement
      snapshot.

#### Acceptance criteria

- At least one focused test fails against the current FIFO for the demonstrated reason.
- Runtime race tests prove that removing session serialization does not permit stale realization to
  publish.
- No test relies on sleeps, debug logs, or asset files outside the repository.

#### Decisions and course corrections

- Completed 2026-08-31. The focused session test failed against the original FIFO exactly as
  predicted: the runtime had accepted the unrelated upsert, but the later player tick and removal
  had not reached presentation while realization remained unresolved.
- The runtime race test passed before the production cutover. It proved that a tick accepted during
  visual loading supplies both the placement and presentation level installed after the load
  resolves.
- Existing tests already covered exact removal, shared-visual generation supersession, attachment
  ordering, and mirror recovery. No duplicate race harness or asset-backed test was added.
- Evidence command before the cutover:
  `npm exec vitest run src/client/client-presentation-session.test.ts src/lib/game/runtime/game-presentation-runtime.test.ts`
  produced one intentional session-test failure and 41 passes.

### Phase 2: Remove realization from movement ordering

#### Deliverables

- Refactor `ClientPresentationSession.#receiveDynamic()` to apply ticks and removals synchronously
  and observe realization promises independently.
- Capture the tick receipt clock before any asynchronous boundary.
- Remove the global mutation FIFO and directly apply synchronous server-time and discontinuity
  mutations.
- Preserve explicit awaited initialization and portal-convergence operations.

#### Task checklist

- [x] Delete `#mutationQueue` and `#enqueueMutation()`.
- [x] Route ticks directly to `applyDynamicEntityTick()`.
- [x] Invoke upsert immediately and attach generation-current error reporting without awaiting it
      before later event handling.
- [x] Invoke removals immediately.
- [x] Make snapshot replacement and eligibility reevaluation explicit promise-returning barriers,
      not members of a universal queue.
- [x] Verify that destroy still aborts construction and lets `GamePresentationRuntime.destroy()`
      await runtime-owned continuations.
- [x] Keep `ClientPresentationRuntime` narrow; do not expose scheduler internals.

#### Acceptance criteria

- The Phase 1 starvation test passes.
- Client presentation tests for hydration, mirror recovery, portal reveal, removal, and teardown pass.
- No replacement FIFO, event backlog, or implicit fallback is introduced.
- The production change is approximately line-neutral or line-negative excluding tests.

#### Decisions and course corrections

- Completed 2026-08-31. The global queue was deleted rather than split. Ticks, removals,
  environment changes, and scene-interest clearing now apply synchronously; upsert, snapshot, and
  portal eligibility realization retain their existing runtime-owned promises.
- Added one session-local observation helper whose sole responsibility is immediate rejection
  handling. It owns no queue, coalescing, or lifecycle state.
- Documented the runtime contract that snapshot/upsert desired authority is accepted before the
  returned realization promise can settle. No public API split was required.
- Focused verification after the cutover passed all 42 tests, and `npm run check:tests` passed.
- No concession or known debt was introduced in this phase.

### Resteering Gate: Validate the existing runtime contract

Before changing `GamePresentationRuntime`'s public API, review the Phase 1 and Phase 2 evidence:

- Did synchronous desired acceptance preserve same-GUID ordering?
- Did an unresolved older realization observe the latest accepted record or withdraw cleanly?
- Did exact removal and generation replacement remain safe?
- Did attachment-parent realization remain deterministic?
- Did portal convergence remain tied to the current activation receipt?
- Did teardown report failures once without unhandled rejections?

If all answers are yes, retain the existing runtime API and proceed. If not, introduce the smallest
explicit synchronous acceptance contract that addresses the failing invariant, update both client
and Explorer callers in one clean cutover, and delete the ambiguous method it replaces.

#### Execution decision (2026-08-31)

- Gate passed; retain the existing runtime API. The delayed-load test proves same-GUID ticks update
  the desired record consumed at realization commit. Existing exact-removal, generation
  supersession, and child-first attachment tests remain green.
- Portal tests prove duplicate activation retention, same-generation destination replacement,
  installed-player gating, fallback-camera acceptance, and rejection of absent/wrong-generation
  camera output.
- Construction cancellation and owner-release tests remain green. Runtime teardown still settles
  tracked realization continuations before destroying dependent resources.
- Added explicit client coverage proving a rejected fire-and-observe upsert is reported exactly once
  while a later tick still applies immediately. No unhandled rejection or error-swallowing shim is
  needed.
- No concession, API fork, or deferred debt was required. Proceed to the live streaming gate.

### Phase 3: Verify the real streaming boundary

#### Deliverables

- Temporarily extend `live-client-ui-probe.mjs` or create a focused sibling probe to:
  - enter client mode using environment-provided credentials;
  - execute `@tele 21.7s 2.2w`;
  - establish a near-due-east heading;
  - sustain forward run across canonical world X `24000`;
  - record authoritative player placement, camera generation/sequence, dynamic event receipt, and
    presented-player placement or direct tick-application evidence; and
  - redact credentials and bounded diagnostic output.
- Capture at least five identical cold-start crossings and a warm repeat set because streaming work
  is variable.

#### Task checklist

- [x] Prove every run crosses from `0x7c640000` into `0x7d640000`; reject a run that misses the
      route instead of counting it.
- [x] Verify the camera remains generation-current and IPC continues during each crossing.
- [x] Verify intentionally delayed or naturally slow upsert realization overlaps accepted player
      ticks without delaying tick application.
- [x] Inspect the controlled player during at least one hardware-GPU run; confirm it neither runs in
      place behind the camera nor pops forward after streaming.
- [x] Record event/workload facts beside each result rather than treating wall time alone as proof.
- [x] If stalls remain after ticks are direct, profile static publication and render-thread blocking
      as a new cause rather than restoring serialization.

#### Acceptance criteria

- Five valid crossings complete without controlled-player separation/pop behavior.
- Accepted player ticks are applied while unrelated visual realization remains unresolved.
- No camera generation reset, presentation discontinuity, scene-anchor error, WebGL context loss, or
  renderer exception occurs at the landblock boundary.
- Any retained harness enhancement is generic, credential-safe, and materially useful beyond this
  one investigation; otherwise it is removed.

#### Decisions and course corrections

- Completed 2026-08-31. Five fresh-client crossings and a three-leg same-process set (one cache
  establishment leg followed by two warm repeats) all crossed `0x7c64` to `0x7d64` without a
  missing or displaced player presentation sample.
- The first user-driven hardware-rendered crossing crossed
  `0x7c64` to `0x7d64` with 238 player ticks, zero missing presentation samples, and zero distance
  between each applied path initial placement and the installed player root.
- The same crossing observed 302 dynamic upserts. Ninety-four upserts overlapped applied player
  ticks, and the slowest observed realization lasted approximately 1.69 seconds. This directly
  exercises a longer realization window than the original visible stall without delaying movement.
- The camera produced 1,082 ordered events in one generation; WebGL remained live and the client
  reported no error. A hardware screenshot showed the running avatar correctly framed in front of
  the camera after the boundary, with no visible separation or pop.
- The other fresh runs applied 232, 235, 232, and 227 player ticks respectively. Every run reported
  zero missing samples and zero placement mismatch, one camera generation, ordered camera
  sequences, and a live WebGL context. The heaviest of these observed a 2.19-second upsert with 108
  overlapping player ticks.
- The two warm repeats applied 233 and 230 player ticks with the same zero-missing/zero-mismatch
  result. Their maximum upsert durations were approximately 0.1 ms and 17.6 ms, recording the
  expected cache-sensitive workload difference rather than treating it as noise.
- No residual controlled-player stall remained, so the conditional static-publication profiling
  branch was not entered. Three known unsupported motion-hook warnings appeared during population
  loading; they were stable across runs, did not become renderer errors, and are unrelated to this
  scheduling cutover.
- Concession: CDP/synthetic keyboard input does not acquire this app's frontend input ownership,
  and invoking the drive command outside that owner did not move authority. Automated steering was
  abandoned after reproducing the limitation. A person drove the evidence routes while collection,
  validation, screenshots, and shutdown remained automatic. This is harness friction only; no
  product workaround was retained.
- Temporary diagnostics remained only until Phase 4 cleanup and were then removed. No diagnostic
  debt was retained.

### Phase 4: Cleanup and full verification

#### Deliverables

- Remove temporary queue timing, browser globals, route-only output, screenshots, and captured
  profiles.
- Sweep obsolete mutation-queue vocabulary from touched production symbols, tests, and comments.
- Update durable architecture documentation only if the final contract changes a documented owner
  boundary; do not copy transient measurements into standing docs.

#### Task checklist

- [x] Run formatting and type checks.
- [x] Run focused client presentation and game presentation runtime tests.
- [x] Run the complete TypeScript test suite.
- [x] Run ESLint and dead-code checks with warnings treated as failures.
- [x] Run Rust checks only if execution touches Rust unexpectedly.
- [x] Inspect the final diff for temporary diagnostics, stale queue terminology, accidental generated
      output, and unrelated changes.
- [x] Confirm ACE and ACViewer submodule state was not modified by this work.

#### Acceptance criteria

- `npm run check`, `npm run test:ts`, `npm run lint`, and `npm run format:check` pass in
  `apps/holtburger-3d`.
- The real eastbound route passes after the diagnostic probes are removed.
- No task-specific production diagnostics or compatibility shims remain.
- Touched code expresses immediate accepted-state mutation and separately owned realization without
  a global client presentation FIFO.

#### Decisions and course corrections

- Completed 2026-08-31. `npm run check`, `npm run test:ts`, `npm run lint`, and
  `npm run format:check` all pass. The complete TypeScript suite reports 231 files and 1,721 passing
  tests; Svelte/type checking reports zero errors and zero warnings; lint includes dead-code analysis
  and Rust Clippy with warnings denied.
- The focused presentation suites pass 43 tests, including the new held-upsert, rejected-upsert, and
  delayed-visual-load cases. These prove ticks and removals remain immediate while realization is
  pending or rejects, and that late installation uses the latest accepted entity level.
- Removed the temporary live probe events, route mode, browser globals, and eight screenshots. The
  canonical probe has no final diff, and no streaming-probe symbol remains in app or script sources.
- Re-ran the eastbound live route after diagnostic removal as part of the recorded crossing set. No
  product diagnostic or compatibility shim remains.
- The final production cutover is line-negative: the session removes 15 net lines and the runtime
  contract comments add 9, for a net reduction of 6 production lines. The client-wide FIFO and its
  helper vocabulary are gone; separately observed realization reuses the runtime's existing
  desired-record and generation guards.
- No durable architecture document was changed because ownership did not move: accepted world state
  still enters the existing presentation runtime, while asynchronous visual realization remains
  runtime-owned. This plan records the transient measurements and implementation evidence.
- No Rust, protocol, retail marker, ACE, or ACViewer change was made. The pre-existing `ACE` and
  `ACViewer` submodule worktree status remained unchanged throughout.
- Final diff inspection and `git diff --check` found no unrelated edits, generated output, stale
  production queue terminology, or whitespace errors. No implementation debt or concession remains;
  the user-driven steering limitation is confined to the discarded diagnostic harness path.
- A post-completion quality audit tightened the synchronous-acceptance contract on both the concrete
  runtime and injected client runtime interface, collapsed the fake runtime's mutually exclusive
  outcomes into one discriminated state, and made every touched deferred-resource test clean up in
  `finally`. The complete verification gate remained green after these changes.
- Added the reusable smells exposed by this work to `docs/code-quality-audit-patterns.md`: unrelated
  work sharing one ordering lane, acceptance hidden in an async prefix, and cleanup existing only on
  the success path. The async-prefix contract remains deliberately compact because it is documented
  at both interfaces and guarded by a synchronous ordering test; no untracked design concession was
  introduced.

## Risks and Mitigations

### Risk: an async method's synchronous prefix is too implicit

Calling an `async` method does execute through its first `await`, but that fact may be easy to break
during later refactoring.

Mitigation: encode the ordering in a focused test and in the method contract comment. If the test
shows the API is dishonest, use Resteering Gate's explicit synchronous acceptance cutover rather
than relying on convention.

### Risk: overlapping realization commits stale state

Without session serialization, an older visual load can finish after removal, replacement, or a
newer generation.

Mitigation: retain and test the runtime's desired-record identity checks after asynchronous
boundaries. Add ordinary-upsert race coverage where current tests cover only snapshot replacement.

### Risk: attached children realize before their parent

Parallel promise completion can differ from host event order.

Mitigation: keep attachment dependency ownership in `GamePresentationRuntime`; children remain
deferred until the exact parent generation is installed, and parent installation revisits only its
desired children.

### Risk: portal reveal becomes prematurely ready

Removing universal serialization could let an older completion satisfy a newer destination.

Mitigation: preserve activation receipt/generation identity checks and test overlapping portal
convergence explicitly. Portal barriers remain awaited even though ordinary movement is direct.

### Risk: failures become unhandled or overwrite newer state

Fire-and-observe promises can reject after a newer operation succeeds.

Mitigation: attach rejection handling at creation and gate user-facing status by the operation's
current identity where needed. Continue failing loudly; do not swallow realization errors merely to
keep movement flowing.

### Risk: unconstrained parallel visual preparation causes a different hitch

Removing the FIFO may increase concurrent asset preparation during a population burst.

Mitigation: first measure the runtime's existing per-record deduplication and resource caches. Add a
bounded realization admission policy only if post-cutover evidence shows harmful concurrency. Such
policy must never gate accepted desired-state or movement updates.

### Risk: static scene publication independently blocks the browser thread

Direct tick dispatch prevents promise-queue starvation but cannot preempt synchronous main-thread
work.

Mitigation: the five-run live gate distinguishes delayed callback execution from the removed FIFO.
If long frames remain, profile static publication as a separate follow-up with its own workload
counters; do not conflate it with this repair.

## Definition of Done

- [x] The controlled player's accepted movement ticks never await unrelated dynamic visual
      realization.
- [x] Tick playback uses the actual renderer event receipt time.
- [x] New entities may appear late but install at their latest accepted level.
- [x] Removal, generation supersession, attachments, mirror recovery, portal reveal, and teardown
      remain generation-safe.
- [x] The client-wide dynamic mutation FIFO and its obsolete vocabulary are deleted.
- [x] Focused concurrency tests fail before and pass after the repair.
- [x] Five valid eastbound streaming crossings reproduce no player lag/pop.
- [x] Static checks, tests, lint, dead-code analysis, and formatting pass.
- [x] Temporary diagnostics and route-only artifacts are removed.
- [x] No unrelated files, submodules, protocol behavior, or retail behavior markers change.

## Open Questions

None. Focused race tests validated the existing runtime API's synchronous acceptance contract, so
the evidence-gated explicit-API fork was not needed.
