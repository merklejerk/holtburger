# Holtburger 3D Runtime Snapshot Subscription Refactor Plan

## Context

Before this refactor, the browser runtime used `ClientRuntime.subscribe` as a broad push channel for
the full runtime snapshot shape. That snapshot was useful for browser panels, diagnostics, tests,
and coarse application state, but it was also expensive to build because it included asset service
summaries, renderer diagnostics, static coordinator state, static scene query counts, dynamic
summaries, host state, portal/render-pass state, and debug overlay counts.

Dynamic entity animation made this pattern visibly wrong. `BrowserDisplay.svelte` drove
`runtime.tickFrame(...)` from `requestAnimationFrame`. `ClientRuntime.tickFrame` updated dynamic
playback and renderer submissions every frame, then called `#emit()` whenever dynamic playback
changed. Because animated dynamic pose state changed each frame, a full runtime snapshot was created
and delivered to Svelte snapshot subscribers at render-frame cadence.

The corrected architecture is:

- Push subscriptions are for low-latency streams where near-real-time delivery matters.
- Browser panel state uses a cheap pull-based `RuntimeOverviewSnapshot` on a slower polling cadence.
- Full runtime diagnostics use explicit `RuntimeDiagnosticsSnapshot` reads.
- Per-frame rendering, animation, placement, bounds, and renderer submissions continue to run every
  frame without forcing every diagnostic panel to refresh.

## Goal

Split real-time runtime streams from slower overview and diagnostics reads so animated dynamics no
longer force full browser diagnostics snapshot creation every frame.

## Scope

In scope:

- Remove `ClientRuntime.subscribe` usage as a full runtime snapshot delivery path.
- Add explicit public overview and full diagnostics snapshot read APIs.
- Move browser diagnostics/state panels to cheap `500ms` overview polling, with explicit refreshes
  after user/config actions where immediate UI feedback matters.
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
- Keep full runtime snapshots coherent, but make callers request them deliberately.
- Prefer clean cutover over backwards-compatible duplicate channels.

## Phase 1: Introduce Explicit Runtime Snapshot API

Status: complete.

Purpose:

- Make full `RuntimeSnapshot` creation a deliberate pull operation instead of an implicit push side
  effect.

Deliverables:

- Add a public `createSnapshot()` method to `ClientRuntime`.
- Rename private `#createSnapshot()` if needed so call sites read as deliberate full snapshot work.
- Keep `createDiagnosticsReport()` using the explicit snapshot path.

Acceptance criteria:

- Full snapshot creation has a public, intentionally named pull API.
- `createDiagnosticsReport()` still returns the same report shape.
- No behavior changes yet to frame ticking, browser polling, or subscriptions unless the type
  boundary requires it.

Task checklist:

- [x] Add the explicit snapshot read method to `ClientRuntime`.
- [x] Route `createDiagnosticsReport()` through the explicit method.
- [x] Add focused tests for explicit snapshot reads if existing tests only cover subscription
      delivery.
- [x] Run focused runtime tests.

Decisions and course corrections:

- 2026-06-27 dry run: Keep Phase 1 API-only. Moving browser startup to explicit snapshot reads
  belongs with the polling cutover in Phase 2; mixing it into Phase 1 would create a half-migrated
  production path.
- 2026-06-28 implementation: Added public `ClientRuntime.createSnapshot()`, routed
  `createDiagnosticsReport()` and the temporary legacy full-snapshot subscription through it, and
  added a focused runtime test proving explicit reads observe render-policy changes. Subscription
  removal intentionally remains Phase 3 work.
- 2026-06-28 verification: `npm run test:ts -- src/lib/runtime/client-runtime.test.ts` passed
  with 34 tests.

## Phase 2: Replace Broad Snapshot Subscription With Pull/Poll Consumption

Status: complete.

Purpose:

- Move browser diagnostics and panel state from always-pushed full snapshots to a slower polling
  cadence.

Deliverables:

- Replace `BrowserDisplay.svelte` full snapshot subscription with a polling loop.
- Use an explicit browser-local `500ms` polling interval constant.
- Pull an initial full runtime snapshot after runtime creation.
- Trigger an immediate full-snapshot refresh after user/config actions that should refresh UI state
  promptly, such as debug overlay toggles, render policy changes, scene-interest changes, and
  selection changes. This means "do not wait up to 500ms for user-driven UI feedback"; it does not
  mean refresh after animation pose changes.
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

- [x] Add `RUNTIME_SNAPSHOT_POLL_INTERVAL_MS = 500` in the browser runtime owner.
- [x] Add browser polling setup and teardown next to the existing runtime frame loop.
- [x] Pull an initial full runtime snapshot after runtime creation.
- [x] Pull after explicit user/config actions where waiting for the interval would feel stale.
- [x] Remove the broad runtime snapshot subscription from `BrowserDisplay.svelte`.
- [x] Update BrowserDisplay tests or runtime integration tests that assumed pushed full snapshots.

Decisions and course corrections:

- 2026-06-27 dry run: BrowserDisplay is the only production full-snapshot subscriber. The production
  cutover can be small: replace that subscription with `refreshRuntimeSnapshot()`, call it once after
  runtime setup, poll it every `500ms`, and call it after browser-owned user/config handlers.
- 2026-06-28 implementation: Replaced the `BrowserDisplay.svelte` full-snapshot subscription with a
  browser-local `RUNTIME_SNAPSHOT_POLL_INTERVAL_MS = 500`, explicit startup snapshot read, polling
  setup/teardown beside the frame loop, and immediate refreshes after scene-interest, render-policy,
  visibility/debug overlay, and selection actions. `subscribeFrameTelemetry` and `subscribeEvents`
  remain as narrow push streams.
- 2026-06-28 verification: `npm run check` passed with `svelte-check` reporting 0 errors and
  0 warnings.

## Phase 3: Cut Over Runtime Subscription Semantics

Status: complete.

Purpose:

- Remove or narrow the overloaded `ClientRuntime.subscribe` API so future code cannot accidentally
  reattach full snapshots to frame cadence.

Deliverables:

- Delete `subscribe(listener: RuntimeSnapshotListener)`.
- Delete `RuntimeSnapshotListener`, `#listeners`, and `#emit()` if no other full-snapshot push path
  remains.
- Remove full-snapshot emit calls from static coordinator, static source payload, dynamic resource,
  user/config, camera-residency, and dynamic playback paths. Those paths should still update runtime
  state; callers observe them through the next explicit `createSnapshot()` call or through existing
  narrow event/telemetry streams.
- Rename listener types to reflect their actual purpose.
- Update tests away from `runtime.subscribe` unless they are specifically testing the new structural
  event channel.

Acceptance criteria:

- No production code subscribes to full `RuntimeSnapshot` pushes.
- Dynamic animation frame changes do not invoke full snapshot construction through any listener path.
- Tests use explicit snapshot reads after actions rather than preserving the old subscription model
  for convenience.
- Type names no longer imply that full snapshots are a normal push stream.
- Static coordinator changes, static source payload changes, dynamic resource readiness, and
  user/config changes remain visible through the next explicit `createSnapshot()` call.

Task checklist:

- [x] Remove `RuntimeSnapshotListener`.
- [x] Remove `ClientRuntime.subscribe`.
- [x] Remove `#listeners` and `#emit()` if no full-snapshot push path remains.
- [x] Preserve existing `subscribeFrameTelemetry` and `subscribeEvents` behavior.
- [x] Update runtime tests to call the explicit snapshot method after state-changing operations.
- [x] Add a regression test proving dynamic playback ticks update renderer submissions without
      invoking full snapshot construction/listeners.
- [x] Add or update coverage proving static coordinator and dynamic resource changes are observable
      through explicit `createSnapshot()` reads.
- [x] Run focused runtime and browser tests.

Decisions and course corrections:

- 2026-06-27 dry run: This is the blast-radius phase. Production has one broad full-snapshot
  subscriber, but `client-runtime.test.ts` uses `runtime.subscribe(...)` heavily as a convenient
  state getter. Most of those tests should become action/flush/`runtime.createSnapshot()` assertions
  rather than preserving a bad push API for test convenience.
- 2026-06-27 dry run: Do not leave a vestigial full-snapshot bus. If production polling is in place
  and tests are migrated, delete `#listeners`, `RuntimeSnapshotListener`, `subscribe()`, and
  `#emit()` instead of narrowing them without a real caller.
- 2026-06-28 implementation: Deleted the full runtime snapshot subscription API, listener set, and
  emit path. Static coordinator updates, static source payload ingestion, dynamic resource readiness,
  user/config changes, camera residency changes, materialization completion/failure, and dynamic
  playback now update runtime state without pushing full `RuntimeSnapshot` objects. Existing
  `subscribeFrameTelemetry` and `subscribeEvents` remain unchanged.
- 2026-06-28 implementation: Migrated runtime tests from `runtime.subscribe(...)` to explicit
  `runtime.createSnapshot()` reads after the actions under test. Added a regression test proving
  frame ticks still commit dynamic renderer instances while avoiding full runtime snapshot builders.
- 2026-06-28 verification: `rg` found no remaining production/test calls to the deleted full
  runtime snapshot subscription. `npm run test:ts -- src/lib/runtime/client-runtime.test.ts`
  passed with 35 tests. `npm run check` passed with `svelte-check` reporting 0 errors and
  0 warnings.

## Phase 4: Resteer Snapshot Shape And Cadence

Status: complete.

Purpose:

- Reassess whether one `RuntimeSnapshot` is still the right shape once callers are polling it
  intentionally.

Deliverables:

- Review browser consumers of `RuntimeSnapshot` after the subscription cutover.
- Decide whether to keep one full runtime snapshot or split it into narrower pull APIs, such as
  `createRuntimeOverviewSnapshot`, `createDiagnosticsSnapshot`, or `createSelectionSnapshot`.
- Record any fields that are expensive enough to deserve lazy or panel-specific loading.
- Decide whether static scene query counts should remain in the default full runtime snapshot or move
  behind a diagnostics-only pull.

Acceptance criteria:

- The plan is updated with concrete next-phase steering based on post-cutover code, not guesses.
- Any remaining expensive default snapshot fields are either justified or scheduled for cleanup.

Task checklist:

- [x] Inspect actual browser snapshot consumers after Phase 3.
- [x] Profile or instrument snapshot creation only if the code still suggests meaningful cost.
- [x] Update this plan with retained snapshot fields, candidate split fields, and cleanup targets.

Decisions and course corrections:

- 2026-06-28 review: Keep one full `RuntimeSnapshot` API for now because browser polling is capped
  at `500ms` and diagnostics report generation still benefits from one coherent on-demand shape.
  Splitting it immediately would add API surface before there is a second production consumer.
- 2026-06-28 retained default fields: `BrowserDisplay.svelte` directly consumes `sceneInterest`,
  `currentCameraResidency`, `currentPortalOverlapResidency`, `portalFrameWorkPlan`,
  `debugOverlays`, `assets` counts, `static` coordinator summary/latest payloads, and
  `staticSceneQuery` counts for navigation/debug panels.
- 2026-06-28 candidate split fields: `dynamic`, `host`, `renderer`, `renderPassPlan`, and
  `staticMaterialization` are not direct BrowserDisplay panel dependencies after the cutover. They
  are still used by tests or `createDiagnosticsReport()`, so the next cleanup should consider a
  diagnostics-only pull such as `createDiagnosticsSnapshot()` or `createRuntimeDiagnosticsSnapshot()`
  before removing them from the default full snapshot.
- 2026-06-28 expensive/default cleanup targets: `staticSceneQuery.createSnapshot()` still walks
  committed query records for debug counts, and `assetService.createSnapshot()` still sorts detailed
  pending/committed entries when the browser panel only displays counts. If snapshot creation remains
  visible after this refactor, move static scene query counts and detailed asset entries behind a
  diagnostics/debug-tab pull or expose cheaper count-only overview fields.
- 2026-06-28 instrumentation decision: No temporary profiling hooks were added in Phase 4. The code
  now removes frame-cadence full snapshot construction, and remaining snapshot creation is explicit
  startup/action/`500ms` polling work. Add profiling only if the polled snapshot path remains hot in
  browser devtools.

## Phase 5: Cleanup And Verification

Status: complete.

Purpose:

- Remove leftover naming, tests, and assumptions from the old full-snapshot push model.

Deliverables:

- Remove dead listener fields, types, helpers, and tests.
- Rename variables in browser UI from generic `snapshot` only if a narrower name is clearer after
  the cutover.
- Update any plan docs that still describe runtime snapshots as a real-time subscription mechanism.
- Run full app verification.

Acceptance criteria:

- No vestigial full-snapshot subscription path remains.
- Browser diagnostics continue to work at the intended polling cadence.
- Dynamic animations continue to render and update selection/debug overlays without causing full
  snapshot emission every frame.
- Full TypeScript, lint, and dead-code verification pass.

Task checklist:

- [x] Remove dead code and misleading names.
- [x] Update docs if any runtime/snapshot guidance became stale.
- [x] Run `npm run check`.
- [x] Run `npm run lint:ts`.
- [x] Run `npm run test:ts`.
- [x] Run `npm run lint:dead`.
- [x] Run root `git diff --check`.

Decisions and course corrections:

- 2026-06-28 cleanup: Removed the legacy full runtime snapshot listener API and updated the older
  v2 render-pipeline correction plan so it no longer points at runtime snapshot subscription cleanup
  as unresolved follow-up work.
- 2026-06-28 verification: `npm run check`, `npm run lint:ts`, full `npm run test:ts` (61 files,
  501 tests), `npm run lint:dead`, and root `git diff --check` passed. Repo-wide
  `npm run format:check` still reports pre-existing formatting issues in unrelated files, so only
  the touched files were formatted and checked with Prettier.

## Phase 6: Add Cheap Runtime Overview Snapshot

Status: complete.

Purpose:

- Split browser polling data from full diagnostics so the `500ms` browser poll reads a cheap,
  intentionally small overview instead of the full diagnostic bundle.

Deliverables:

- Add a `RuntimeOverviewSnapshot` type for browser panel state that is expected to refresh on a
  slow polling cadence.
- Add `createOverviewSnapshot()` to `ClientRuntime`.
- Keep `createSnapshot()` as the full diagnostic snapshot API for now; consider renaming only after
  callers are migrated and the diagnostics boundary is settled.
- Add cheap overview/count APIs for dependencies that currently build expensive detail only to show
  counts, starting with assets, static coordinator state, and static scene query state.
- Keep real-time streams unchanged: `subscribeFrameTelemetry` for frame metrics and
  `subscribeEvents` for discrete runtime events.

Acceptance criteria:

- `createOverviewSnapshot()` does not call full diagnostic builders such as
  `assetService.createSnapshot()` just to display counts.
- The overview DTO contains only fields directly needed by always-polled browser UI.
- Full diagnostics remain available through the explicit full snapshot/report path.
- Runtime tests prove overview reads observe state changes without rebuilding full diagnostic
  snapshots.

Task checklist:

- [x] Define `RuntimeOverviewSnapshot` in `client-runtime.ts`.
- [x] Add `ClientRuntime.createOverviewSnapshot()`.
- [x] Add count/overview APIs for asset service state.
- [x] Add count/overview APIs for static coordinator state.
- [x] Add count/overview APIs for static scene query state.
- [x] Add focused tests proving overview reads do not invoke full snapshot builders.
- [x] Run focused runtime tests.

Decisions and course corrections:

- 2026-06-28 follow-up steering: Prefer one cheap overview pull plus one full diagnostics pull over
  many panel-specific APIs. More splits should wait for evidence from real consumers or profiling.
- 2026-06-28 dry run: The overview DTO still needs several debug-panel fields, not just navigation
  state: scene interest, camera residency, portal frame/overlap state, debug overlay counts, static
  coordinator counts plus latest terrain/env-cell payload summaries, static scene query counts, and
  asset pending/committed counts.
- 2026-06-28 dry run: Add a `StaticCoordinatorOverviewSnapshot` instead of reusing full
  `StaticCoordinatorSnapshot`. `StaticCoordinator.createSnapshot()` sorts material coverage and
  static object bake diagnostics; BrowserDisplay only needs `revision`, requested/resolving/baking/
  committed counts, and latest terrain/env-cell payload summaries.
- 2026-06-28 dry run: Add an `AssetServiceOverviewSnapshot` with counts only. This requires changing
  the `AssetService` interface and every test fake that implements it. Keep this in Phase 6 so
  Phase 7 can be a browser cutover rather than a mixed interface migration.
- 2026-06-28 dry run: `StaticSceneQuery.createSnapshot()` is already count-oriented, but it computes
  more counts than BrowserDisplay displays and still walks committed record roots. Add a narrower
  overview/count method first; only add mutation-maintained cached counts if profiling shows the
  narrower read is still visible.
- 2026-06-28 dry run: `debugOverlays.envCellAabbCount` and `debugOverlays.portalCount` still require
  query/count work when their toggles are enabled. Keep that behavior in the overview because those
  numbers are explicitly shown beside the toggles; do not move overlay counts behind full
  diagnostics unless the UI also stops showing them live.
- 2026-06-28 implementation: Added `RuntimeOverviewSnapshot`,
  `ClientRuntime.createOverviewSnapshot()`, `AssetServiceOverviewSnapshot`,
  `StaticCoordinatorOverviewSnapshot`, and `StaticSceneQueryOverviewSnapshot`. The runtime overview
  reads cheap dependency overview/count APIs and does not build full asset, static coordinator,
  renderer, host, dynamic, or static-materialization diagnostics.
- 2026-06-28 implementation: Added a focused runtime regression test that spies on the static
  coordinator full snapshot builder and checks asset/renderer diagnostic builder counters while
  reading overview state.
- 2026-06-28 verification: `npm run test:ts -- src/lib/runtime/client-runtime.test.ts` passed with
  36 tests. `npm run check` passed with `svelte-check` reporting 0 errors and 0 warnings.

## Phase 7: Move Browser Polling To Runtime Overview

Status: complete.

Purpose:

- Make `BrowserDisplay.svelte` poll the cheap overview snapshot while keeping full diagnostics
  opt-in.

Deliverables:

- Replace BrowserDisplay polling of `runtime.createSnapshot()` with
  `runtime.createOverviewSnapshot()`.
- Rename browser state from generic `snapshot` to an overview-oriented name if the type split makes
  the distinction clearer.
- Keep the Diagnostics Report button on the full diagnostic path.
- Preserve immediate overview refreshes after user/config actions.

Acceptance criteria:

- Browser diagnostics/status panels still populate after startup and refresh within the `500ms`
  cadence.
- Texture filtering mode, debug overlay toggles, render policy controls, scene-interest changes,
  and selection state remain responsive after explicit user/config actions.
- Opening the diagnostics report still pulls the full diagnostic shape on demand.
- Browser polling no longer builds dynamic records, full renderer diagnostics, host state, detailed
  asset entries, or static materialization details unless the overview explicitly needs them.

Task checklist:

- [x] Update BrowserDisplay state and polling to use `RuntimeOverviewSnapshot`.
- [x] Rename `refreshRuntimeSnapshot()` to an overview-specific helper such as
      `refreshRuntimeOverview()`.
- [x] Keep full diagnostics report generation on the explicit full snapshot/report path.
- [x] Update browser/runtime tests that assumed polling used `RuntimeSnapshot`.
- [x] Run `npm run check`.
- [x] Run focused runtime/browser tests.

Decisions and course corrections:

- 2026-06-28 dry run: This phase should be mostly mechanical if Phase 6 lands cleanly. The browser
  currently stores `let snapshot = $state<RuntimeSnapshot | null>(null)` and uses it throughout the
  navigate/debug panels; after the split, rename this to `runtimeOverview` or `overviewSnapshot` to
  prevent future code from casually reaching for full diagnostics in the polled path.
- 2026-06-28 dry run: `openDiagnosticsReport()` already calls `runtime.createDiagnosticsReport()`,
  so the full diagnostic path can stay isolated while polling moves to overview. Do not make the
  diagnostics modal consume the cheap overview; it should remain an explicit heavy read.
- 2026-06-28 dry run: Picking uses the current camera residency from the polled state to choose an
  env-cell context fallback. The overview must keep `currentCameraResidency` or this path will
  silently regress.
- 2026-06-28 dry run: Keep immediate refreshes after scene-interest, render-policy, debug overlay,
  static visibility, and selection actions, but call the renamed overview refresh helper. Do not add
  refreshes to RAF or camera policy sync; that would recreate the hot path with a cheaper DTO.
- 2026-06-28 implementation: Moved `BrowserDisplay.svelte` polling and immediate user/config
  refreshes from `runtime.createSnapshot()` to `runtime.createOverviewSnapshot()`. Renamed the
  browser state to `runtimeOverview` and the refresh/poll helpers to overview-specific names.
- 2026-06-28 implementation: Updated browser asset status rendering to use overview asset counts
  instead of full pending/committed arrays. `openDiagnosticsReport()` remains on
  `runtime.createDiagnosticsReport()`.
- 2026-06-28 verification: `npm run check` passed with `svelte-check` reporting 0 errors and
  0 warnings. `npm run lint:ts` passed. `npm run test:ts -- src/lib/runtime/client-runtime.test.ts`
  passed with 36 tests.
- 2026-06-28 final verification: Full `npm run test:ts` passed with 61 files and 502 tests.
  `npm run lint:dead` passed. Root `git diff --check` passed.

## Phase 8: Reassess Full Diagnostic Snapshot Naming And Cost

Status: complete.

Purpose:

- Decide whether `createSnapshot()` should remain the full diagnostic API name or be renamed to make
  expensive diagnostic work impossible to call casually.

Deliverables:

- Inspect remaining `createSnapshot()` callers after BrowserDisplay moves to overview polling.
- Decide whether to rename full runtime snapshot reads to `createDiagnosticsSnapshot()` or
  `createFullDiagnosticsSnapshot()`.
- Decide whether `createDiagnosticsReport()` should consume a full diagnostic snapshot DTO or build
  directly from narrower diagnostic helpers.
- Record any remaining expensive default fields with an owner and cleanup trigger.

Acceptance criteria:

- Full diagnostic snapshot naming makes cost and intended use clear.
- Any retained expensive diagnostic fields are justified by an actual diagnostics consumer.
- Any fields not needed by production diagnostics are removed or scheduled with a concrete follow-up.

Task checklist:

- [x] Inspect post-overview full diagnostic snapshot callers.
- [x] Rename full diagnostic snapshot API if the current `createSnapshot()` name is too generic.
- [x] Update tests and docs for the chosen naming.
- [x] Record retained expensive fields and cleanup triggers.
- [x] Run `npm run check`, `npm run lint:ts`, and focused runtime tests.

Decisions and course corrections:

- 2026-06-28 dry run: Do not rename `createSnapshot()` in Phase 6. Keeping the full diagnostic API
  stable while introducing `createOverviewSnapshot()` reduces blast radius and keeps the browser
  cutover reviewable.
- 2026-06-28 dry run: After Phase 7, expected full snapshot callers should be runtime tests,
  `createDiagnosticsReport()`, and intentionally diagnostic tools. If BrowserDisplay polling still
  calls `createSnapshot()`, Phase 7 is incomplete.
- 2026-06-28 dry run: A rename to `createDiagnosticsSnapshot()` is probably worth doing if
  `createSnapshot()` has no production browser polling caller after Phase 7. The spicy bit is test
  churn, not runtime behavior; schedule the rename only after confirming callers are diagnostic.
- 2026-06-28 dry run: `createDiagnosticsReport()` may not need to materialize the entire full
  `RuntimeSnapshot` forever. If Phase 8 shows report fields are narrower than `RuntimeSnapshot`,
  prefer direct diagnostics helpers over carrying an expensive DTO just because it exists.
- 2026-06-28 implementation: BrowserDisplay no longer calls the full runtime snapshot API after
  Phase 7. Remaining full snapshot callers were runtime tests and `createDiagnosticsReport()`, so
  the full API was renamed from `createSnapshot()` to `createDiagnosticsSnapshot()` and the DTO was
  renamed from `RuntimeSnapshot` to `RuntimeDiagnosticsSnapshot`.
- 2026-06-28 implementation: Kept `createDiagnosticsReport()` backed by the full diagnostic snapshot
  for now because it still consumes broad diagnostic domains: assets, renderer, static coordinator,
  texture manager, terrain texture fallbacks, render pass/portal plan, materialization counts, and
  runtime status. A direct report-builder split is lower priority now that browser polling is on the
  cheap overview path.
- 2026-06-28 debt: Full diagnostic snapshot fields that remain intentionally expensive are
  `assets`, `renderer`, `dynamic`, `host`, `static`, `staticSceneQuery`, and
  `staticMaterialization`. Keep them diagnostic-only; revisit direct report helpers only if
  diagnostic report generation itself shows measurable cost.
- 2026-06-28 verification: `npm run check` passed with `svelte-check` reporting 0 errors and
  0 warnings. `npm run test:ts -- src/lib/runtime/client-runtime.test.ts` passed with 36 tests.

## Phase 9: Final Naming And Documentation Cleanup

Status: complete.

Purpose:

- Remove stale wording and loose naming left behind by the overview/diagnostics split without
  reopening the architecture.

Deliverables:

- Update current plan/doc wording where old `RuntimeSnapshot`, `runtime.createSnapshot()`, or
  `refreshRuntimeSnapshot()` references now read like active architecture instead of historical
  context.
- Rename local runtime test variables from generic `snapshot` to `diagnosticsSnapshot` or
  `overviewSnapshot` where the distinction helps reviewers.
- Re-scan runtime/browser docs and tests for generic snapshot language that could mislead future
  work.
- Keep repo-wide unrelated Prettier churn out of this cleanup unless it is explicitly requested.

Acceptance criteria:

- Active docs describe browser polling as `RuntimeOverviewSnapshot` and full diagnostic reads as
  `RuntimeDiagnosticsSnapshot`.
- Historical notes can keep old names only when clearly describing pre-refactor behavior.
- Runtime tests use names that make overview-vs-diagnostics intent clear.
- No unrelated formatting churn is introduced.

Task checklist:

- [x] Clean stale active-voice `RuntimeSnapshot` and `createSnapshot()` wording in this plan.
- [x] Rename ambiguous runtime test locals where they now refer to diagnostics snapshots.
- [x] Search runtime/browser docs and tests for misleading generic snapshot language.
- [x] Run scoped Prettier check for touched files.
- [x] Run `npm run check`, `npm run lint:ts`, and focused runtime tests.
- [x] Run root `git diff --check`.

Decisions and course corrections:

- 2026-06-28 cleanup: Updated the plan's active context and resolved decisions to describe the
  current `RuntimeOverviewSnapshot` polling path and explicit `RuntimeDiagnosticsSnapshot` read path.
  Earlier phase notes still preserve old names where they document pre-refactor behavior or migration
  steps.
- 2026-06-28 cleanup: Renamed ambiguous runtime test locals so diagnostics reads use
  `*DiagnosticsSnapshot` names and the cheap overview read uses `overviewSnapshot`.
- 2026-06-28 verification: Scoped Prettier check passed for this plan and
  `client-runtime.test.ts`. `npm run check`, `npm run lint:ts`, and
  `npm run test:ts -- src/lib/runtime/client-runtime.test.ts` passed.

## Risks And Mitigations

- Risk: Browser UI panels become stale after actions that previously caused an immediate push.
  Mitigation: centralize browser-side `refreshRuntimeOverview()` and call it immediately after
  user/config actions, while retaining `500ms` polling for passive diagnostics.

- Risk: Tests keep the old architecture alive because subscription assertions are convenient.
  Mitigation: update tests to call the explicit snapshot read API after actions; keep push tests only
  for truly real-time or event-specific streams.

- Risk: Selection/debug overlays require per-frame dynamic bounds.
  Mitigation: keep overlay and renderer update paths inside `tickFrame`; only stop full browser
  runtime snapshot emission from riding along.

- Risk: Polling still creates too much snapshot work.
  Mitigation: keep the first cut simple with unconditional `500ms` polling while `BrowserDisplay` is
  mounted; Phase 6 and Phase 7 split expensive diagnostics out of the polled path.

- Risk: A narrow structural event channel recreates the same overloaded bus with a different name.
  Mitigation: structural events should carry revisions or small reason payloads, not full
  `RuntimeDiagnosticsSnapshot` objects.

## Definition Of Done

- `requestAnimationFrame` driven `tickFrame` no longer creates full `RuntimeDiagnosticsSnapshot`
  objects just because dynamic animation playback changes.
- Full runtime diagnostics snapshots are requested explicitly by diagnostics or tests.
- Real-time subscriptions remain narrow and cheap.
- Browser diagnostics still refresh at a documented slower cadence.
- Dynamic animation, dynamic renderer submissions, portal overlap updates, and frame telemetry still
  work.
- Focused and full TypeScript verification pass.

## Open Questions

- None currently.

## Resolved Decisions

- Browser runtime overview polling cadence is `500ms`.
- Polling runs unconditionally while `BrowserDisplay` is mounted; no panel-visibility gating in the
  first cut.
- The cheap browser-polled runtime state is `RuntimeOverviewSnapshot`.
- The expensive full runtime diagnostic state is `RuntimeDiagnosticsSnapshot`, read through
  `ClientRuntime.createDiagnosticsSnapshot()`.
- The completed follow-up correction split browser polling into a cheap runtime overview snapshot
  before considering narrower panel-specific APIs.
