# Explorer Possession Run-Rate Control Plan

## Context and Boundaries

### Goal

Give Explorer possession a host-validated `1.0` through `10.0` run-rate control that drives the
same rate-adjusted animation, authored movement, fallback movement, and planar jump behavior as
retail's resolved Run-skill-and-burden scalar.

### In Scope

- Add an Explorer-owned run-rate range whose initial and minimum values are `1.0` and whose maximum
  is `10.0`.
- Carry the selected scalar through every coalescible possession intent and non-coalescible
  lifecycle snapshot.
- Apply the scalar through the existing retail-adjusted character-axis resolver so animation rate
  and physical translation stay synchronized.
- Preserve retail's command-specific behavior:
  - walking does not read run rate;
  - run-forward and run-held backward movement read run rate;
  - run-held sidestep reads run rate and retains retail's `3.0` interpreted-rate cap;
  - turn rate depends on whether Run is held, but never on the actor's run-rate scalar;
  - planar jump launch uses the release snapshot's resolved run rate while vertical launch does
    not.
- Expose the host-owned bounds and initial value to the Explorer UI and show the active value in
  possession diagnostics.
- Consolidate live frontend possession stance and run rate so the Inspector does not mistake the
  initial possession receipt for mutable accepted state.
- Verify that real possessable content remains inside animation and collision-solver budgets at the
  `10.0` ceiling.

### Out of Scope

- Adding a fake Run skill, burden, encumbrance, or character-stat model to Explorer possession.
- Changing `run_rate_from_skill_and_burden` or the playable client's authoritative movement
  capability resolution.
- Scaling walk speed with the slider.
- Scaling turns with the slider. Run-held turning remains retail's fixed `1.5` rate.
- Removing retail's sidestep-rate cap.
- Rescaling an already committed airborne velocity when the slider changes.
- Changing shared collision budgets merely to accommodate an unevidenced extreme.
- Persisting the selected rate across possession generations or application restarts. Each new
  possession begins at the host-reported initial rate.
- Preserving the old wire shape through defaults or compatibility shims.

## Ground Truth

### Retail References

- `acclient-eor-source/acclient.c:329739-329787`, `CMotionInterp::apply_run_to_command`:
  - positive `WalkForward` becomes `RunForward` and its rate is multiplied by `my_run_rate`;
  - run-held turn is multiplied by the constant `1.5` without reading `my_run_rate`;
  - run-held sidestep is multiplied by `my_run_rate` and clamped to magnitude `3.0`.
- `acclient-eor-source/acclient.c:329792-329849`, `get_max_speed` and
  `get_adjusted_max_speed`: run rate is a dimensionless multiplier over the base run speed.
- `acclient-eor-source/acclient.c:329850-329925`, `get_state_velocity`: walk, run, and sidestep
  commands resolve to base velocities before the run-rate-dependent maximum-speed cap.
- `acclient-eor-source/acclient.c:330006-330063`, `adjust_motion`: backward and left/right sidestep
  commands canonicalize to signed walk/sidestep commands before held-run adjustment.

### Existing Production Patterns

- `crates/holtburger-world/src/context.rs`: `run_rate_from_skill_and_burden` produces the playable
  client's resolved retail scalar. Explorer supplies the same lower-level fact directly rather
  than inventing qualities it does not own.
- `crates/holtburger-core/src/client/character_axes.rs`: `adjust_character_axes` already implements
  the proven walk/run, backward, sidestep, turn, and diagonal rules. It is the single rate-adjustment
  owner for possession playback and jump launch.
- `crates/holtburger-world/src/motion/selection.rs`: selecting a motion scales both clip framerate
  and explicit velocity/omega; changing a same-direction cyclic motion's speed preserves cursor
  phase and replaces its explicit physics contribution.
- `apps/holtburger-3d/src-tauri/src/explorer_possession_control.rs`: possession capabilities,
  fallback rates, controller state, adjusted axes, and complete resolved intent are already
  colocated here.
- `apps/holtburger-3d/src-tauri/src/explorer_entity_runtime.rs`: fixed-tick possession proposals
  consume the resolved order, exact authored offset, fallback channels, and lifecycle snapshots.
- `apps/holtburger-3d/src/explorer/ExplorerApp.svelte`: the frontend owns possession input,
  revisions, stance selection, lifecycle edges, and third-person camera coordination.
- `apps/holtburger-3d/src/explorer/ExplorerEntityInspector.svelte`: stance and possession
  diagnostics establish the appropriate local UX surface.

### Current Evidence

- Explorer input defaults to Run and uses Shift for Walk in
  `character-input-controller.ts:105-123`.
- Before this change, `ExplorerPossessionControlProfile::standard` fixed possession run rate at
  `1.0` inside `CharacterJumpKinematics`.
- Standard fallback run speed is `4.0 m/s` at object scale one. At run rate `10.0`, the nominal
  request is `40.0 m/s`, or `1.333... m` per 30 Hz tick.
- The shared grounded profile uses `0.24 m` maximum substeps and a 32-substep budget. The nominal
  scale-one request therefore needs six substeps, but real authored rates and object scales still
  require a census.
- Before this change, the Inspector read `ExplorerPossession.acceptedStance`, which was the initial
  host receipt, while `ExplorerApp` separately tracked later accepted stance changes. The displayed
  stance and capability source could therefore become stale.

## North Stars

1. Treat the UI value as an already-resolved actor capability, not as a fake skill or a generic
   physical throttle.
2. Compute retail-adjusted axes once per accepted possession snapshot and let playback, fallback
   actuation, and jump consume that contract.
3. Preserve animation phase when the operator changes rate while moving.
4. Keep Explorer range and presentation policy app-local; shared crates retain reusable retail
   semantics only.
5. Make the deliberate `10.0` ceiling honest: retail command rules remain intact, but the Explorer
   can provide a scalar above retail's naturally attainable `4.5` maximum.
6. Let real content and solver budgets determine whether high-speed support needs more work.
7. Keep live accepted frontend controls in one state shape rather than mixing mutable state with an
   initial receipt.
8. Fail loudly on malformed or stale contracts; do not clamp, default, or partially accept them.

## Phase 0: Prove the 10x Runtime Envelope

**Status: census complete; implementation proceeds with the existing solver's bounded-prefix
behavior recorded as an explicit concession.**

### Deliverables

- Add a temporary debug-harness census over every possessable creature template and every offered
  stance that models `RunForward`.
- For target-authored and fallback run channels, record:
  - template and motion-table counts;
  - base and object-scaled run-speed distribution;
  - maximum exact authored translation produced by any 30 Hz tick at rate `10.0`;
  - required grounded collision substeps at `0.24 m` per substep;
  - frames, hooks, cycles, and clip boundaries crossed in the busiest tick;
  - templates whose request would exceed the 32-substep or 64-boundary runtime budgets.
- Record the dated census results in this plan and delete the asset-dependent temporary harness.
- Use the results as the blast-radius census in the required `RETAIL DIVERGENCE` marker.

### Task Checklist

- [x] Reuse `MotionSequenceCatalog`, creature-template projection, offered possession stances, and
      runtime object scale rather than reconstructing asset semantics.
- [x] Exercise the exact `MotionSequenceRuntime` path at `1 / 30` seconds instead of reducing every
      clip to an average speed.
- [x] Include target-authored explicit velocity and root motion.
- [x] Include fallback `4.0 m/s * 10.0 * object_scale` where the target run channel is absent or
      physically motionless.
- [x] Report representative percentiles and named maxima, not only a global maximum.
- [x] Stop and resteer before changing a shared solver budget if shipped content exceeds it.
- [x] Remove the temporary binary or harness after retaining the evidence.

### Acceptance Criteria

- Every shipped possessable run channel has a known `10.0` tick envelope and records whether the
  current solver completes it or commits a bounded safe prefix.
- The plan records the effective physical clamp for channels beyond the current collision budget.
- Any required budget or behavioral change is evidence-backed and separately justified.
- No asset-dependent census remains in the permanent test suite.

### Decisions and Course Corrections

- **2026-08-23 — Phase 0 stop gate triggered.** The temporary census ran against 7,831 creature
  templates: 7,788 resolved a motion table, 43 did not, and 37,119 template/stance cohorts were
  modelled. 34,519 cohorts used target-authored run translation and 2,600 used the standard
  fallback channel.
- At the `10.0` ceiling, object-scaled base run speed was `7.914 / 11.782 / 16.595 / 1,500.000`
  m/s at p50/p95/p99/max. The corresponding maximum requested speed was
  `45.981 / 68.371 / 96.489 / 10,499.999` m/s, with planar distance per 30 Hz tick of
  `1.533 / 2.279 / 3.216 / 350.000` m and required grounded substeps of
  `7 / 10 / 14 / 1,459` at those percentiles/maxima.
- 28 template/stance cohorts exceed the current 32-substep budget. Named outliers include WCID
  `4119` **Colossal Monouga** (scale `400`, authored, `10,499.999` m/s, `1,459` substeps), WCID
  `23205` **Tremendous Monouga** (scale `20`, authored, `525` m/s, `73` substeps), WCID `44629`
  **Shadow Vortex** (scale `10`, fallback, `400` m/s, `56` substeps), and WCID `19440` **Wall of
  Webbing** (scale `7`, fallback, `280` m/s, `39` substeps). Object scale is a real runtime input:
  it scales authored grounded translation and collision geometry in the existing production path.
- The same run reported a maximum clip framerate of `2,400` fps, zero hooks in one tick, at most
  one observed public clip change per tick (three over the 300-tick sample), and zero observed
  boundary-risk cohorts. Its public boundary observation peaked at one per tick. The permanent
  diagnostic contract deliberately does not add the sequence runtime's private exact
  boundary-iteration counter because no production consumer requires that field; the `64`-boundary
  requirement remains an explicit measurement debt, and no boundary overflow is claimed from the
  public observation.
- **2026-08-23 — Budget semantics clarified.** `solve_grounded` computes the requested substep
  count, evaluates `min(required_substeps, maximum_substeps)`, commits that safe prefix, appends a
  stationary remainder through the end of the tick, and returns `GroundedOutcome::BudgetExceeded`.
  The generic physical-body layer commits this as `PhysicalBodyTickStatus::SubstepBudgetExceeded`;
  it is not an exception or a failed transaction. With Explorer's `0.24 m`/`32` profile, the
  unconstrained displacement ceiling is about `7.68 m` per tick.
- This is therefore a bounded-behavior concession rather than a hard implementation blocker. We
  will not change the shared solver budget in this feature. Outlier entities can observe a physical
  speed clamp below their requested `10.0` authored/fallback rate, so the applied status/effective
  rate must remain visible in diagnostics and verification. Exact 10x physical translation for
  those outliers remains a separate future policy decision.
- The temporary census was deleted after its evidence and focused tests were retained. The code-level
  `RETAIL DIVERGENCE` marker now records the same content/solver blast radius at the host-owned
  maximum.

## Phase 1: Establish the Host-Owned Run-Rate Contract

### Deliverables

- In `apps/holtburger-3d/src-tauri/src/explorer_possession_control.rs`, add a validated app-local
  `PossessionRunRateScalar` with named `INITIAL`, `MINIMUM`, and `MAXIMUM` facts of `1.0`, `1.0`, and
  `10.0`.
- Reject non-finite values and values outside the closed range; do not clamp.
- Add a serializable `PossessionRunRateCapability` carrying `initial`, `minimum`, and `maximum`.
- Include that capability in active possession receipts and represent it as absent in released
  receipts.
- Mark the `10.0` maximum as `RETAIL DIVERGENCE` with:
  - the `acclient.c` run-rate evidence;
  - the consequence of correcting it to retail's `4.5` attainable maximum;
  - the Phase 0 content and solver census;
  - the fact that only explicitly Explorer-possessed entities can observe the divergence.
- Rename the profile's fixed-rate jump field or wrap it with an honest resolver so it is clearly a
  rate-one base profile, then construct `CharacterJumpKinematics` for each accepted run rate.

### Task Checklist

- [x] Keep validation and bounds in the app-local host; do not add Explorer limits to
      `holtburger-core` or `holtburger-world`.
- [x] Reuse the existing validated `CharacterMovementKinematics` and `CharacterJumpKinematics`
      constructors when resolving a supplied rate.
- [x] Comment the new capability and resolved-intent fields.
- [x] Extend `PossessionControlProfileError` or `PossessionIntentError` with one precise invalid-rate
      failure mode.
- [x] Add unit tests for both inclusive bounds, below/above bounds, NaN, and infinities.

### Acceptance Criteria

- The host owns one validated run-rate range and publishes it to the frontend.
- A new possession has an explicit rate-one resolved intent before the frontend sends input.
- Invalid values cannot enter `ActivePossession` or `ResolvedPossessionIntent`.
- No shared crate gains Explorer range policy.

### Decisions and Course Corrections

- **2026-08-23 — Host contract implemented.** `PossessionRunRateScalar` owns the closed
  `1.0..=10.0` range, rejects non-finite input without clamping, and publishes the standard
  capability only from active possession receipts. The rate-one `base_jump` profile is resolved
  into one `PossessionResolvedKinematics` composite for every accepted intent.
- The deliberate 10x ceiling is marked at the app-owned constant with the retail command and
  maximum-speed citations plus the Phase 0 census. No shared crate received Explorer policy.
- Focused coverage passes for inclusive bounds, invalid numeric values, atomic rejection, and the
  retail divergence matrix.

## Phase 2: Cut Over Complete Intent and Lifecycle Snapshots

### Deliverables

- Add required `runRateScalar` fields to the TypeScript and Rust possession intent contracts:
  - `ExplorerPossessionIntent`;
  - `ExplorerPossessionEventRequest` through its complete-intent intersection;
  - `ExplorerPossessionIntentWireRequest`;
  - `ExplorerPossessionEventWireRequest`;
  - `ExplorerPossessionIntentRequest`;
  - `ExplorerPossessionEventRequest`.
- Make both Tauri and development HTTP host request resolution validate the scalar before invoking
  the entity runtime.
- Extend `ResolvedPossessionIntent` with the complete rate-resolved jump/movement kinematics. Read
  the scalar back through that composite contract when diagnostics need it; do not store a second
  independently mutable float.
- Resolve adjusted axes once from the request's drive and rate-resolved movement kinematics.
- Ensure reset and effective-drive restoration preserve the applied intent's rate.
- Ensure queued lifecycle events retain the exact kinematics resolved with their contemporaneous
  run-rate snapshot.

### Task Checklist

- [x] Change the intent wire resolver from infallible to fallible validation and update both host
      adapters.
- [x] Pass the validated rate through `ActivePossession::replace_intent` and `queue_event`.
- [x] Make `resolve_effective_intent` reuse the applied intent's resolved kinematics.
- [x] Remove the fixed `profile.jump` consumption from jump-release handling; use the queued
      intent's kinematics.
- [x] Sweep every Rust and TypeScript request literal; add no serde or frontend defaults.
- [x] Preserve possession-generation and revision checks before mutation.
- [x] Extend the possession motion probe with the currently applied `runRateScalar`.

### Acceptance Criteria

- Every accepted replaceable intent and lifecycle edge contains a validated run rate.
- Jump release uses the rate captured with that ordered edge even if a newer slider value is
  accepted before the tick consumes it.
- A reset clears drive state without silently resetting the possession's selected run rate.
- Tauri and HTTP harness requests reject the same malformed values.
- The old wire shape fails clearly rather than being interpreted as rate one.

### Decisions and Course Corrections

- **2026-08-23 — Complete snapshots cut over.** Tauri and development HTTP adapters now reject
  malformed run-rate scalars before runtime mutation; runtime validation remains as the typed
  ownership boundary. Replaceable intents, ordered lifecycle edges, reset restoration, and jump
  release all carry one resolved kinematics composite.
- The host probe now reports requested/applied run rate, physical tick status, and achieved planar
  speed. A production Tauri pull command feeds the Inspector's disclosure-scoped diagnostics; the
  HTTP harness retains the same probe shape.
- Added regression coverage for a queued 1x jump release arriving before a newer 10x intent: the
  release uses 1x launch kinematics while the newer intent applies afterward.

## Phase 3: Drive Playback, Fallback, and Jump Through Existing Retail Semantics

### Deliverables

- Feed each accepted intent's resolved movement kinematics to `adjust_character_axes`.
- Continue deriving `MotionOrder` from the resulting axes without adding a second multiplier at the
  physical-actuation boundary.
- Preserve the current target-authored/fallback channel selection:
  - target-authored run clips receive the adjusted rate and naturally scale root motion and explicit
    velocity with playback;
  - fallback run velocity multiplies its `4.0 m/s` base by the same adjusted rate;
  - target presentation remains the only visible presentation when fallback physics is required.
- Use the same resolved kinematics for planar jump launch.

### Task Checklist

- [x] Prove rate-one behavior is unchanged for authored and fallback channels.
- [x] Prove walk-forward playback and translation are identical at run rates `1.0` and `10.0`.
- [x] Prove run-forward playback framerate and translation scale from `1.0` to `10.0`.
- [x] Prove live same-direction rate changes preserve the active animation cursor.
- [x] Prove run-held backward movement scales by `-0.65 * run_rate`.
- [x] Prove run-held sidestep retains the retail magnitude-`3.0` interpreted-rate cap.
- [x] Prove walk turn remains rate `1.0` and run-held turn remains rate `1.5` at both slider
      extremes.
- [x] Prove jump planar velocity changes with run rate, vertical velocity does not, and the existing
      combined planar cap uses the resolved run rate.
- [x] Prove changing the slider while airborne does not rescale retained world velocity.

### Acceptance Criteria

- Animation and translation remain synchronized for authored run motion within the solver budget;
  budget-exceeded channels expose the existing physical safe-prefix clamp rather than silently
  claiming their full requested displacement.
- Fallback movement follows the same adjusted command rates as target-authored movement.
- No run-rate multiplication exists in `possession_grounded_actuation`.
- Turning is affected by gait exactly as retail specifies and is independent of slider value.
- Existing target-only presentation and standard-physics fallback policy is unchanged.

### Decisions and Course Corrections

- **2026-08-23 — Existing retail adjustment path retained.** No second multiplier was added at
  physical actuation. The resolved axes drive target-authored playback and fallback channels; the
  one-substep regression proves a `SubstepBudgetExceeded` tick commits its matching run clip and
  reports its safe-prefix achieved speed instead of replaying the previous proposal.
- Focused runtime coverage now includes authored/fallback 1x-vs-10x translation, unchanged walk,
  retail backward/sidestep/turn rules, jump planar/vertical separation, queued release snapshots,
  and airborne rate changes.

## Phase 4: Consolidate and Expose Live Explorer Controls

### Deliverables

- In `ExplorerApp.svelte`, replace the loose possession stance state with one active possession
  control shape containing the current accepted stance and desired run-rate scalar.
- Initialize the shape from each active possession receipt's accepted stance and run-rate
  capability; clear it when that possession generation retires.
- Add one helper that builds the shared complete possession snapshot fields for:
  - ordinary drive replacement;
  - stance changes;
  - run-rate changes;
  - begin-jump, release-jump, and reset lifecycle edges.
- Pass the current controls and a run-rate update callback through `ExplorerTools.svelte` and
  `ExplorerEntitiesPanel.svelte` to `ExplorerEntityInspector.svelte`.
- Add an accessible native range control beside Stance:
  - label: `Run rate`;
  - host-reported minimum and maximum;
  - frontend presentation step `0.25`;
  - formatted current value such as `6.25x`;
  - disabled when the selected entity is not the exact active possession or an operation prevents
    control mutation.
- Send a complete revised intent immediately when the value changes.
- Make the stance selector and capability diagnostics consume the current accepted control state,
  not the initial receipt's `acceptedStance`.
- Show the host-applied run rate in sampled diagnostics so transport or revision disagreement is
  visible.

### Task Checklist

- [x] Keep the rate per possession generation; initialize every new generation to the receipt's
      explicit initial value.
- [x] Keep the native slider readout keyboard-accessible and do not require pointer input.
- [x] Use the existing coalescible revision path for slider changes.
- [x] Preserve the edge's captured drive while merging the common stance, rate, generation, and
      revision fields.
- [x] Report transport failures through the existing presentation-error surface.
- [x] Update frontend contract fixtures and session forwarding tests.

### Acceptance Criteria

- The Inspector always displays the current accepted stance and selected run rate.
- Moving the slider while running changes playback without restarting the clip.
- Shift+forward visibly returns to unscaled walking at every slider value.
- Rapid slider changes cannot let an older revision overwrite the latest host intent.
- New possessions begin at `1.0`; no prior entity's rate leaks across generations.
- Browser and host diagnostics agree on the applied value after settlement.

### Decisions and Course Corrections

- **2026-08-23 — Live Explorer control shipped through the app boundary.** Stance and run rate now
  share one possession-generation control shape initialized from the host receipt. The native
  range uses host bounds with a `0.25` presentation step and an accessible formatted readout.
- Run-rate input is intentionally coalescible and does not serialize every native `input` event;
  each request still carries a monotonic revision and the host rejects stale revisions. Optimistic
  control-state merging keeps rapid rate and stance edits in one complete snapshot, while the
  Inspector's sampled host probe distinguishes requested from applied values.
- The Tauri and HTTP/harness possession contracts share the required scalar; session/fixture tests
  now cover the capability, intent, lifecycle, and motion-probe shapes.

## Phase 5: Runtime Verification and Cleanup

### Deliverables

- Extend the browser harness or a focused deterministic possession scenario to exercise production
  HTTP contracts, fixed ticks, real animation playback, and collision-aware motion at `1.0` and
  `10.0`.
- Verify at least one target-authored run channel and one standard-fallback run channel.
- Exercise slider changes while idle, while running, while walking, during jump charge, after jump
  release, and after possession replacement.
- Sweep stale possession-rate vocabulary, duplicate bounds, obsolete fixed-rate assumptions, and
  request builders.
- Run formatting, TypeScript/Svelte checks, Rust checks, clippy with warnings denied, focused tests,
  and the browser harness.

### Task Checklist

- [x] Add or update Rust unit tests in `explorer_possession_control.rs`.
- [x] Add or update possession fixed-tick integration tests in `explorer_entity_runtime.rs`.
- [x] Update `explorer-entity-possession.test.ts` and
      `explorer-dynamic-entity-session.test.ts` contract fixtures.
- [x] Run `npm run test:ts` from `apps/holtburger-3d`.
- [x] Run `npm run check` from `apps/holtburger-3d`.
- [x] Run `npm run lint` from `apps/holtburger-3d`.
- [x] Run `npm run format:check` from `apps/holtburger-3d`.
- [x] Run the relevant Rust tests through the Tauri manifest.
- [x] Run `npm run harness:browser -- ...` on a deterministic branch-specific port with the focused
      possession scenario.
- [x] Exercise rate changes while idle, walking, jump charge, after jump release, and after
      possession replacement in the deterministic scenario.
- [x] Inspect browser errors and machine-readable motion/path diagnostics, not only screenshots.
- [x] Sweep `runRateScalar`, the prior fixed `1.0` profile assumption, and possession request
      literals with `rg`.

### Acceptance Criteria

- All focused and repository-prescribed checks pass with no clippy warnings.
- The browser harness demonstrates faster authored animation and collision-aware translation at
  `10.0` without changing walk or turn rate.
- The solver completes the evidenced shipped-content envelope, or the plan explicitly accepts each
  bounded safe-prefix result as current policy and exposes its physical status/effective speed.
- No compatibility fallback, duplicate control state, temporary census, or unused metric remains.

### Decisions and Course Corrections

- **2026-08-23 — Verification complete.** Rust unit/integration tests passed through the Tauri
  manifest (`215` tests, plus binary and doc-test targets), and `cargo clippy --all-targets
  -- -D warnings` passed. The Explorer package passed `npm run test:ts` (`181` files, `1,383`
  tests), `npm run check`, `npm run lint`, and `npm run format:check`.
- The deterministic browser scenario ran on Vite port `1497` with WCID `1` and the possession
  scenario enabled. The active receipt advertised `1.0..=10.0`; the maximum-rate probe reported
  requested rate `10.0`, solved physical status, `10.0` playback speed, and faster planar motion.
  The expanded scenario also changed rate while idle, while walking, during charge, after release,
  and after a same-entity possession replacement. Idle remained stationary, walking retained
  command speed `1.0` at both slider ends, the charged probe moved from requested `1.0` to `10.0`,
  the post-release probe accepted `1.0`, and the replacement receipt reset to `1.0` before a new
  `10.0` intent was accepted. Focused Rust fixtures prove the corresponding walk translation
  equality; raw browser displacement is retained as environment-sensitive evidence rather than a
  flaky assertion. Backward movement, sidestep, turn, jump, safe-prefix, and release-generation
  assertions passed; the harness's captured browser error/exception list was empty. The runner
  still printed its expected Chrome GCM shutdown diagnostics and existing motion-table part-coverage
  warnings. The first harness attempt intentionally exposed an omitted `runRateScalar` request
  field; the request builder was corrected and the reruns passed, confirming that stale wire shapes
  fail instead of silently defaulting.
- Added a runtime regression for reset: a `10.0` applied snapshot survives a queued reset and the
  restored run intent still drives `10.0` playback.
- The machine-readable census and focused safe-prefix regression record the 28 over-budget cohorts:
  the solver commits their bounded prefix and surfaces `SubstepBudgetExceeded`/effective speed.
  Exact 10x physical translation for those outliers remains outside this change; no shared budget was
  raised.
- The vocabulary sweep found no surviving fixed-rate profile or duplicate live possession control;
  remaining `1.0` literals are explicit rate-one fixtures/bounds. The asset-dependent census binary
  was removed after the evidence was recorded.

## Risks and Mitigations

### The UI Implies 10x Sidestep but Retail Caps It

The control is a run-rate scalar, not a universal speed multiplier. Retail clamps run-held
sidestep's interpreted rate to magnitude `3.0`, so lateral motion stops increasing before the
slider reaches `10.0`.

Mitigation: label the control `Run rate`, retain the retail cap, cover it explicitly in tests, and
show command sources/rates in diagnostics. Removing the cap would require a separate named
divergence and is not part of this feature.

### High Authored Rates or Object Scales Exhaust Solver Budgets

The nominal standard character is safe, but target-authored root motion and object scale can make a
possessed creature much faster.

Mitigation: complete Phase 0 before changing behavior. Do not globally raise collision budgets
without measured shipped-content evidence and cost analysis.

### High Rate Crosses Too Much Animation Work Per Tick

At `10.0`, short clips may cross many frames, hooks, cycles, or clip boundaries in one 30 Hz tick.
The runtime intentionally bounds clip-boundary traversal.

Mitigation: census and exercise the exact sequence runtime, retain hook ordering, and treat a
reached boundary budget as a correctness issue rather than silently dropping work.

### Slider Requests Arrive Out of Order

Native range input can emit changes faster than transport completion.

Mitigation: use the existing revisioned complete-intent replacement contract. The host rejects
stale revisions, and the frontend retains one current desired state rather than accepting response
order as state order.

### Jump Uses a Different Rate Than Ground Playback

Today jump kinematics are supplied by a fixed profile. Updating playback without changing the
queued jump snapshot would create a visible and physical disagreement.

Mitigation: store rate-resolved `CharacterJumpKinematics` in `ResolvedPossessionIntent` and consume
the queued intent's value at release.

### Initial Receipt Is Mistaken for Live Control State

The current stance UI already has this split. Adding run rate directly to the receipt without a
live frontend control shape would repeat it.

Mitigation: consolidate live stance and rate in `ExplorerApp`; use the receipt only to initialize a
new possession generation and advertise capabilities.

## Definition of Done

- [x] Active possession receipts advertise the host-owned `1.0..=10.0` run-rate capability.
- [x] All intent and lifecycle requests require a validated run-rate scalar.
- [x] The Explorer divergence above retail's attainable `4.5` maximum is fully marked and censused.
- [x] Walking is unchanged by slider value.
- [x] Running animation and target-authored/fallback translation respond to slider value together.
- [x] Backward, sidestep, turn, diagonal, and jump behavior match the proven retail adjustment
      matrix, including caps.
- [x] Live rate changes preserve animation phase.
- [x] Queued lifecycle events use their captured rate and stale generations/revisions remain inert.
- [x] The Inspector exposes an accessible `1.0..=10.0` control and accurate live diagnostics.
- [x] Live stance and run rate share one frontend possession-control state.
- [x] Real shipped-content motion and solver envelopes at `10.0` are recorded.
- [x] Temporary asset-dependent diagnostics are removed.
- [x] TypeScript, Svelte, Rust, clippy, formatting, focused tests, and browser-harness verification
      pass.

## Open Questions

The Phase 0 census does not block the initial implementation because the existing solver has an
explicit safe-prefix result rather than a failed transaction. The implementation will preserve
that behavior, commit possession playback alongside `SubstepBudgetExceeded`, and expose the
status/effective clamp in diagnostics. If product later requires exact physical `10.0` translation
for the 28 over-budget cohorts (including the scale-400 Colossal Monouga), that is a separate
solver-budget or high-speed-policy decision; this feature will not silently make that change.

The plan otherwise deliberately chooses:

- `0.25` as the frontend slider step;
- reset to the host-reported `1.0` initial rate for every new possession generation;
- retention of retail's sidestep cap and fixed run-held turn rate;
- no persistence beyond the active possession epoch.

If product feedback later asks for sub-`1.0` slow motion, uncapped sidestep, walk scaling, or
cross-possession persistence, each changes the semantic contract and should be scoped separately
rather than hidden inside this run-rate control.
