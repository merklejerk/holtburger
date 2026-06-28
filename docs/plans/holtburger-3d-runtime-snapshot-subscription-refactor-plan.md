# Holtburger 3D Runtime Snapshot Subscription Refactor Plan

## Context

The browser runtime currently uses `ClientRuntime.subscribe` as a broad push channel for
`RuntimeSnapshot`. That snapshot is useful for browser panels, diagnostics, tests, and coarse
application state, but it is also expensive to build because it includes asset service summaries,
renderer diagnostics, static coordinator state, static scene query counts, dynamic summaries, host
state, portal/render-pass state, and debug overlay counts.

Dynamic entity animation made this pattern visibly wrong. `BrowserDisplay.svelte` drives
`runtime.tickFrame(...)` from `requestAnimationFrame`. `ClientRuntime.tickFrame` updates dynamic
playback and renderer submissions every frame, then calls `#emit()` whenever dynamic playback
changes. Because animated dynamic pose state changes each frame, a full `RuntimeSnapshot` is now
created and delivered to Svelte snapshot subscribers at render-frame cadence.

The target architecture is:

- Push subscriptions are for low-latency streams where near-real-time delivery matters.
- Full runtime inspection snapshots are pull-based and can be polled at a slower cadence by browser
  diagnostics.
- Per-frame rendering, animation, placement, bounds, and renderer submissions continue to run every
  frame without forcing every diagnostic panel to refresh.

## Goal

Split real-time runtime streams from slower inspection snapshots so animated dynamics no longer
force full browser diagnostics snapshot creation every frame.

## Scope

In scope:

- Refactor `ClientRuntime.subscribe` usage so full `RuntimeSnapshot` delivery is no longer the
  render-loop invalidation path.
- Add an explicit public snapshot read API, or rename the existing private snapshot creator into a
  clearly inspection-oriented API.
- Move browser diagnostics/state panels to slow polling, with explicit refreshes for structural UI
  actions where needed.
- Keep `subscribeFrameTelemetry` as the real-time frame telemetry stream.
- Keep `subscribeEvents` for discrete runtime events.
- Add or adjust tests so dynamic animation ticks update renderer state without emitting full runtime
  snapshots every frame.

Out of scope:

- Redesigning renderer frame telemetry.
- Reworking static coordinator snapshots beyond how the browser consumes them.
- Changing dynamic animation playback, placement tracking, or renderer instance submission behavior.
- Adding durable diagnostic records for snapshot creation cost.
- Optimizing individual snapshot builders before fixing the ownership model.

## Current Evidence

Observed hot path:

- `apps/holtburger-3d/src/pages/BrowserDisplay.svelte`
  - `startRuntimeFrameLoop` calls `runtime.tickFrame(timestampMilliseconds / 1000)` from
    `requestAnimationFrame`.
  - The browser subscribes to `runtime.subscribe((nextSnapshot) => { snapshot = nextSnapshot; ... })`.
- `apps/holtburger-3d/src/lib/runtime/client-runtime.ts`
  - `tickFrame` calls `#dynamicEntityController.tick(timeSeconds)`.
  - `tickFrame` calls `#commitDynamicRendererInstances(timeSeconds)` every frame.
  - `tickFrame` calls `#emit()` when `portalOverlapChanged || dynamicPlaybackChanged`.
  - `#emit()` calls `#createSnapshot()` and delivers the result to every runtime snapshot listener.
  - `#createSnapshot()` includes `#assetService.createSnapshot()`,
    `#dynamicEntityController.createSnapshot()`, `#host.createSnapshot()`,
    `#renderer.createDiagnosticsSnapshot()`, `#staticSceneQuery.createSnapshot()`, static
    coordinator/materialization summaries, render policy, render-pass state, portal-frame work
    state, and debug overlay counts.
- `apps/holtburger-3d/src/lib/runtime/static-scene-query.ts`
  - `createSnapshot()` walks committed env-cell records and static BVH roots to compute counts.
- `apps/holtburger-3d/src/lib/assets/asset-service.ts`
  - `createSnapshot()` sorts pending and committed asset entries.
- `apps/holtburger-3d/src/lib/dynamic/dynamic-entity-store.ts`
  - `createSnapshot()` sorts dynamic records and maps them to DTO summaries.

Profiler evidence from browser devtools showed frame work passing through:

- `pushRuntimeFrame`
- `tickFrame`
- `#emit`
- `#createSnapshot`
- `createSnapshot static-scene-query.ts`
- asset-service snapshot sorting

## Design Principles

- Do not use full runtime snapshots as a render-loop state bus.
- Do not preserve a bad API only because tests conveniently observe it.
- Do not solve this by only adding a throttle to `#emit`; throttling can be a browser polling
  policy, but the runtime API should expose the correct ownership model.
- Keep real-time DTOs narrow and cheap.
- Keep inspection snapshots coherent, but make callers request them deliberately.
- Prefer clean cutover over backwards-compatible duplicate channels.

## Phase 1: Introduce Explicit Inspection Snapshot API

Status: pending.

Purpose:

- Make full `RuntimeSnapshot` creation a deliberate inspection operation instead of an implicit
  push side effect.

Deliverables:

- Add a public `createInspectionSnapshot()` or `createSnapshot()` method to `ClientRuntime`.
- Rename private `#createSnapshot()` if needed so call sites read as inspection/diagnostics work.
- Keep `createDiagnosticsReport()` using the inspection snapshot path.
- Update the initial runtime UI setup to request an initial snapshot through the explicit API.

Acceptance criteria:

- Full snapshot creation has a public, intentionally named pull API.
- `createDiagnosticsReport()` still returns the same report shape.
- No behavior changes yet to frame ticking or subscriptions unless the type boundary requires it.

Task checklist:

- [ ] Add the explicit snapshot read method to `ClientRuntime`.
- [ ] Route `createDiagnosticsReport()` through the explicit method.
- [ ] Add focused tests for explicit snapshot reads if existing tests only cover subscription
      delivery.
- [ ] Run focused runtime tests.

Decisions and course corrections:

- Pending.

## Phase 2: Replace Broad Snapshot Subscription With Pull/Poll Consumption

Status: pending.

Purpose:

- Move browser diagnostics and panel state from always-pushed full snapshots to a slower polling
  cadence.

Deliverables:

- Replace `BrowserDisplay.svelte` full snapshot subscription with a polling loop.
- Use an explicit browser-local polling interval constant, initially in the `250ms` to `500ms`
  range unless profiling justifies another value.
- Trigger an immediate poll after structural browser actions that should refresh UI state promptly,
  such as debug overlay toggles, render policy changes, scene-interest changes, and selection
  changes.
- Keep `subscribeFrameTelemetry` for FPS/frame-handler metrics.
- Keep `subscribeEvents` for discrete runtime events.

Acceptance criteria:

- Browser diagnostics still populate after startup.
- UI panels refresh within the chosen slow polling cadence.
- Texture filtering mode and other currently snapshot-backed controls remain responsive after user
  changes.
- Frame telemetry still updates in real time.
- Runtime frame ticks no longer deliver a full snapshot to Svelte every frame.

Task checklist:

- [ ] Add browser polling setup and teardown next to the existing runtime frame loop.
- [ ] Pull an initial inspection snapshot after runtime creation.
- [ ] Pull after explicit structural actions where waiting for the interval would feel stale.
- [ ] Remove the broad runtime snapshot subscription from `BrowserDisplay.svelte`.
- [ ] Update BrowserDisplay tests or runtime integration tests that assumed pushed full snapshots.

Decisions and course corrections:

- Pending.

## Phase 3: Cut Over Runtime Subscription Semantics

Status: pending.

Purpose:

- Remove or narrow the overloaded `ClientRuntime.subscribe` API so future code cannot accidentally
  reattach full snapshots to frame cadence.

Deliverables:

- Delete `subscribe(listener: RuntimeSnapshotListener)` if no production caller remains.
- If a structural push channel is still required, replace it with a narrow event or revision
  subscription that does not carry a full snapshot.
- Rename listener types to reflect their actual purpose.
- Update tests away from `runtime.subscribe` unless they are specifically testing the new structural
  event channel.

Acceptance criteria:

- No production code subscribes to full `RuntimeSnapshot` pushes.
- Dynamic animation frame changes do not invoke full snapshot construction through any listener path.
- Tests use explicit snapshot reads after actions rather than preserving the old subscription model
  for convenience.
- Type names no longer imply that full snapshots are a normal push stream.

Task checklist:

- [ ] Remove or narrow `RuntimeSnapshotListener`.
- [ ] Remove or narrow `ClientRuntime.subscribe`.
- [ ] Update runtime tests to call the explicit snapshot method after state-changing operations.
- [ ] Add a regression test proving dynamic playback ticks do not emit full runtime snapshots.
- [ ] Run focused runtime and browser tests.

Decisions and course corrections:

- Pending.

## Phase 4: Resteer Snapshot Shape And Cadence

Status: pending.

Purpose:

- Reassess whether one `RuntimeSnapshot` is still the right shape once callers are polling it
  intentionally.

Deliverables:

- Review browser consumers of `RuntimeSnapshot` after the subscription cutover.
- Decide whether to keep one inspection snapshot or split it into narrower pull APIs, such as
  `createRuntimeOverviewSnapshot`, `createDiagnosticsSnapshot`, or `createSelectionSnapshot`.
- Record any fields that are expensive enough to deserve lazy or panel-specific loading.
- Decide whether static scene query counts should remain in the default inspection snapshot or move
  behind a diagnostics-only pull.

Acceptance criteria:

- The plan is updated with concrete next-phase steering based on post-cutover code, not guesses.
- Any remaining expensive default snapshot fields are either justified or scheduled for cleanup.

Task checklist:

- [ ] Inspect actual browser snapshot consumers after Phase 3.
- [ ] Profile or instrument snapshot creation only if the code still suggests meaningful cost.
- [ ] Update this plan with retained snapshot fields, candidate split fields, and cleanup targets.

Decisions and course corrections:

- Pending.

## Phase 5: Cleanup And Verification

Status: pending.

Purpose:

- Remove leftover naming, tests, and assumptions from the old full-snapshot push model.

Deliverables:

- Remove dead listener fields, types, helpers, and tests.
- Rename variables in browser UI from generic `snapshot` where a narrower diagnostic/inspection name
  is clearer.
- Update any plan docs that still describe runtime snapshots as a real-time subscription mechanism.
- Run full app verification.

Acceptance criteria:

- No vestigial full-snapshot subscription path remains.
- Browser diagnostics continue to work at the intended polling cadence.
- Dynamic animations continue to render and update selection/debug overlays without causing full
  snapshot emission every frame.
- Full TypeScript, lint, and dead-code verification pass.

Task checklist:

- [ ] Remove dead code and misleading names.
- [ ] Update docs if any runtime/snapshot guidance became stale.
- [ ] Run `npm run check`.
- [ ] Run `npm run lint:ts`.
- [ ] Run `npm run test:ts`.
- [ ] Run `npm run lint:dead`.
- [ ] Run root `git diff --check`.

Decisions and course corrections:

- Pending.

## Risks And Mitigations

- Risk: Browser UI panels become stale after actions that previously caused an immediate push.
  Mitigation: centralize browser-side `refreshInspectionSnapshot()` and call it immediately after
  structural user actions, while retaining slower polling for passive diagnostics.

- Risk: Tests keep the old architecture alive because subscription assertions are convenient.
  Mitigation: update tests to call the explicit snapshot read API after actions; keep push tests only
  for truly real-time or event-specific streams.

- Risk: Selection/debug overlays require per-frame dynamic bounds.
  Mitigation: keep overlay and renderer update paths inside `tickFrame`; only stop full browser
  inspection snapshot emission from riding along.

- Risk: Polling still creates too much snapshot work when diagnostics panels are hidden.
  Mitigation: after the first cutover, consider tying polling cadence to panel visibility or split
  expensive diagnostics into panel-specific pull APIs.

- Risk: A narrow structural event channel recreates the same overloaded bus with a different name.
  Mitigation: structural events should carry revisions or small reason payloads, not full
  `RuntimeSnapshot` objects.

## Definition Of Done

- `requestAnimationFrame` driven `tickFrame` no longer creates full `RuntimeSnapshot` objects just
  because dynamic animation playback changes.
- Full runtime inspection snapshots are requested explicitly by browser diagnostics or tests.
- Real-time subscriptions remain narrow and cheap.
- Browser diagnostics still refresh at a documented slower cadence.
- Dynamic animation, dynamic renderer submissions, portal overlap updates, and frame telemetry still
  work.
- Focused and full TypeScript verification pass.

## Open Questions

- What initial browser diagnostics polling cadence should we use: `250ms`, `500ms`, or another value
  after quick profiling?
- Should polling run unconditionally while `BrowserDisplay` is mounted, or only while diagnostics
  panels are visible?
- Should the first implementation keep one inspection snapshot or immediately split static query and
  asset diagnostics into panel-specific pull APIs?
