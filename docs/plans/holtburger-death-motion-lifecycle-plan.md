# Death motion and playback lifecycle

Status: complete. All three phases implemented and verified.

## Context and boundaries

Goal: play a creature's death transition, interrupt prior playback correctly, and initialize its replacement corpse in the authored dead state.

In scope: refactor shared motion admission and playback lifecycle in `holtburger-world`; update affected local-player and Explorer callers; separate death animation from locomotion eligibility; verify network-driven creation/update behavior and browser presentation.

Out of scope: combat mechanics, loot, server corpse timing, a new animation engine, frontend corpse heuristics, a general event-history system, presentation clock synchronization, and unrelated movement redesign.

This is a focused structural correction. Preserve content decoding, motion-table selection where correct, and the frontend `Playing`/`Settled` contract. Replace the lifecycle ambiguity between receipt of authority and advancement of playback.

## Ground truth and evidence

Paths below are repository-relative. Retail line numbers refer to `acclient-eor-source/acclient.c`.

| Source | Relevant behavior |
| --- | --- |
| `ACE/Source/ACE.Server/WorldObjects/Creature_Death.cs`, `Die`, `CreateCorpse` | Execute `NonCombat / Dead`, wait for its animation duration, create a separate corpse, destroy the creature. Copy setup, motion table, and appearance into the ordinary corpse. |
| `ACE/Source/ACE.Server/WorldObjects/WorldObject.cs`, `ExecuteMotion` | Select server animation, retain motion state, broadcast it, return animation duration. |
| `ACE/Source/ACE.Server/WorldObjects/Corpse.cs`, `SetEphemeralValues` | Initialize the corpse's motion to `NonCombat / Dead`. |
| `ACE/Source/ACE.Server/WorldObjects/WorldObject_Networking.cs`, movement serialization | Include retained movement in object creation data. |
| Retail `CMotionInterp::DoInterpretedMotion`, lines 330249–330284 | Clear link animations before accepting `Dead`; also clear links after motion application when the object has no cell. |
| Retail `CPhysicsObj::RemoveLinkAnimations`, line 305608; `MotionTableManager::HandleEnterWorld`, line 317294 | Remove transition prefix and retire pending animation bookkeeping. |
| Retail `CSequence::remove_all_link_animations`, line 326503 | Preserve the cyclic destination, moving the cursor to its starting frame when necessary. This is not an arbitrary last-frame operation. |
| Retail creation, line 374747; `CPhysicsObj::set_description`, line 310465 | Apply initial movement during description installation, before adding the object to the world. |

Completed controlled probes used Drudge Prowler WCID 192, setup `0x020007DD`, motion table `0x09000008`:

- Authored death transition: animation `0x030000EF`, inclusive frames 0–39, 30 fps. Dead destination: frame 39, zero fps.
- Production world advancement retained the mob's idle presentation and produced no corpse presentation after ten simulated seconds. `advance_authored_motion_except` filters out `Dead` before driving playback.
- Direct selector playback performed the transition and settled correctly. A fresh `BodyMotionRuntime` given `Dead` instead started the transition, demonstrating the missing initialization operation.
- `AttackHigh1` remained active when the runtime received `Dead`, demonstrating missing interruption semantics.
- Browser playback performed the supplied death clip and held its terminal pose. A fresh presentation with no motion remained upright; the authored settled pose rendered correctly. These were injected presentation inputs, not a live server kill or an end-to-end fixed client.

Temporary probe code was removed. Screenshots under `/tmp/death-probe-*.png` are session evidence, not durable fixtures. Only one creature table has been exercised so far; do not generalize its single-frame destination to the archive.

## Constraints, concessions, and north stars

- Network admission owns freshness, object generation, and autonomous echo filtering. Playback must not re-admit packets or infer receipt from snapshot equality.
- Creation/replacement, accepted updates, and simulation advancement have different meanings. Runtime absence is not an event: resets, table rebinding, and other callers also construct playback.
- Apply an accepted update's steady state and interruption effects before its action list, following retail ordering. Repeated ticks must not repeat interruption or enqueue actions again.
- Keep one authored playback owner for selection, actions, hooks, and root contribution. Visual locomotion cannot overwrite explicit death state.
- Directed movement still resolves each tick using position, contact, and target state. Separate one-time admission effects from continuous resolution; do not freeze move-to/turn behavior at packet receipt.
- Compute shared motion semantics in `world`; retain orchestration in `core` and Explorer policy in the app. Frontends receive resolved clips/poses, not corpse-specific rules.
- The motion catalog is supplied at bootstrap. Preserve explicit diagnostics for unavailable content; do not add deferred replay or an unbounded command buffer. Revisit only if source tracing demonstrates a required case.
- Entities without movement or usable animation content remain valid where currently supported. Missing death content must not be disguised by a fabricated pose.
- Preserve bounded action admission and local prediction/echo behavior. Do not turn this into a larger action-queue redesign.
- Prefer replacing split paths over adding parallel flags or corpse handlers. Every new field must have a named consumer; record why any net line growth is justified.

## Proposed contracts and ownership

Names below describe responsibilities; settle exact names during the first phase.

| Existing shape/path | Proposed treatment |
| --- | --- |
| `EntityMotionSnapshot`, `EntityNetworkMotion` | Retain current wire-derived authority. A snapshot alone is not an instruction to reconstruct or transition playback. |
| `EntityMovementAdmission::Applied` | Use its accepted snapshot and action batch as one coherent playback admission. Include sticky/directive effects in the same ordered application where applicable. Avoid a second durable copy of packet state. |
| Creation/replacement admission | Explicitly establish destination playback after successful entity admission. Do not initialize rejected/deleted generations. |
| `BodyMotionRuntime::new`, `drive`, reset/rebind behavior | Separate establishing state, accepting an update, and advancing/resolving continuous motion. Provide a deliberate reconstruction route; do not synthesize a network event on reset. |
| Sequence prefix and active-action bookkeeping | One runtime-owned operation removes pending transitions and retires the associated action state consistently. Specify how queued actions map to retail cancellation before implementing. |
| `MotionOrder` | Keep as resolved selection input. Do not overload it with packet freshness, initial-placement flags, or frontend policy. |
| `MotionPresentation`, frontend `DynamicEntityMotion` | Preserve `Playing`/`Settled`; no corpse fields or frame guessing. |

The intended flow is: accepted creation establishes playback; accepted updates apply ordered changes to that playback; simulation resolves continuous intent and advances it; projection publishes the selected clip or settled pose.

Same-value accepted updates can have admission effects even when the snapshot compares equal. Conversely, per-tick restatement is not a fresh accepted update. Test both explicitly.

## Phase 1: Close lifecycle decisions and content coverage

Deliverable: complete the behavior matrix below and record source-backed decisions in this document before changing production contracts.

- [x] Trace creation/replacement through `handlers/inventory.rs`, entity liveness admission, and authoritative-body initialization. Identify the single establishment point after acceptance.
- [x] Trace `handlers/movement.rs` through action admission, sticky handling, motion publication, and `motion/registry/remote.rs`. Preserve packet ordering when multiple updates precede one tick.
- [x] Trace local prediction and server-controlled self motion in `crates/holtburger-core/src/client/movement/system.rs`; identify how accepted self motion reaches the owner without duplicate playback or advancement.
- [x] Trace `state/mutations.rs::retire_local_player_motion_epoch`, `reset_authored_motion`, and `bind_table`. Define reconstruction behavior separately for each actual caller.
- [x] Verify retail cancellation of active and queued actions, transition prefixes, and skipped hooks. Do not assume clearing the sequence alone clears the action queue correctly.
- [x] Audit death exclusions and support reduction, including `RemoteMotionState::order` and `MotionOrder::with_character_presentation`. Prove which positional restrictions should remain; do not remove all death checks mechanically.
- [x] Census available dead destinations and death links in mounted motion tables. Record missing rows, multiple clips, nonzero/reverse rates, and differing destination animations. Exercise representative additional creature tables and a player table selected from those results.

Acceptance: each lifecycle case has a named producer, consumer, timing, and source-backed behavior; content exceptions and existing concessions are recorded. Any expansion beyond these boundaries is brought back for alignment.

| Case | Required result |
| --- | --- |
| Fresh already-dead object | Install authored destination without replaying collapse or skipped transition hooks. |
| Living creature receives death | Interrupt required pending playback, select death transition, advance into its authored destination. |
| Death during attack / pending transitions | Cancel precisely the playback retail cancels; no surviving stale active-action ownership. |
| Several accepted updates before a tick | Apply admission effects in receipt order; no action starts under an unrelated old steady state. |
| Repeated ticks / fresh identical update | Ticks preserve progress; fresh updates follow retail admission semantics independently of value equality. |
| Airborne or sliding death | Locomotion reduction does not replace explicit death with `Falling`; physical behavior follows verified rules. |
| Replacement, reset, or table rebind | No leaked cursor, action, or prior-generation state; reconstruction does not manufacture receipt effects. |
| Locally predicted action and echo | Exactly one admitted action and one advancement per interval. |
| Move-to / turn directive | Continue resolving target and support changes each tick; completed directives do not restart. |

## Phase 2: Refactor and integrate in one cutover

Primary files: `crates/holtburger-world/src/entity.rs`, `handlers/inventory.rs`, `handlers/movement.rs`, `state/motion_resolution.rs`, `state/mutations.rs`, `motion/registry.rs`, `motion/registry/remote.rs`, `motion/sequence.rs`, and `motion/state.rs`. Modify `selection.rs` only where the evidence requires selection changes.

Affected callers: `crates/holtburger-core/src/client/movement/system.rs`, `client/simulation.rs`, and `apps/holtburger-3d/host/src/explorer_entity_runtime.rs`; inspect direct runtime users across crates before renaming operations.

- [x] Implement explicit establishment and coherent accepted-update application at the existing authority boundary. Prefer synchronous application with the bootstrap catalog over a new event queue.
- [x] Implement runtime-owned interruption and destination establishment, keeping sequence and action bookkeeping consistent.
- [x] Retain continuous controller/directive selection and support reconciliation without repeating admission effects. Zero-duration reconciliation must not advance time or replay actions/hooks.
- [x] Route create, update, reset, local-player, and Explorer operations through the appropriate lifecycle methods. Keep policy at its existing architectural layer.
- [x] Replace the split remote steady/action application path; remove redundant wrappers, state, and vocabulary in the same change.
- [x] Allow death playback through world advancement and prevent locomotion presentation from overriding it. Preserve source-backed physics restrictions separately.
- [x] Add lightweight synthetic-content tests alongside the refactor for the behavior matrix, including ordered batches and interruption consistency. Replace tests that preserve removed architecture.

Acceptance: changed crates compile; lifecycle tests pass; there is one owner for admission effects and no per-tick replay of them. Existing directed movement, local action echo, and reset tests pass or are replaced with equally substantive coverage.

## Phase 3: Verification and cleanup

- [x] Repeat real-content probes across the representative tables from Phase 1. Tests retained in the repository must not depend on untracked runtime assets.
- [x] Extend the non-interactive browser harness to consume production-world outputs for living → death → replacement corpse, including initial observation of an existing corpse. Verify interruption and late frontend realization. Do not claim an injected settled frame proves the integrated fix.
- [x] Capture before, during, and after death. Verify the corpse does not replay collapse, remains in its destination, and has no upright flash after realization. Check browser errors and entity/resource teardown.
- [x] Run `cargo test -p holtburger-world -p holtburger-core`; test `holtburger-3d-host` if its callers change. Run clippy with `--all-targets -- -D warnings` on changed Rust packages.
- [x] Run workspace Rust formatting checks. If frontend/harness TypeScript changes remain, run the app's `check`, relevant `test:ts`, and `lint:ts` scripts; use the existing `harness:browser` script for runtime validation.
- [x] Review the final diff for obsolete admission paths, duplicate facts, dead tests, and unnecessary flags. Remove temporary probes or retain only useful diagnostic infrastructure with clear ownership.
- [x] Record final contract choices, census results, remaining limitations, and verification commands here. Add source citations to unintuitive production semantics; use retail behavior markers only when their documented convention applies.

Acceptance: the integrated sequence is visually correct, automated checks pass without ignored warnings, and cleanup leaves no parallel old/new lifecycle mechanisms.

## Risks and mitigations

- **Overgeneralizing one table:** use a motion-table census and authored destinations; do not hardcode frame 39 or assume a single clip.
- **Cancellation replays hooks or leaves stale actions:** verify sequence prefix removal and action retirement together, including queued-action cases.
- **Moving selection to receipt changes tick/root semantics:** perform admission with zero elapsed time, verify hook timing, and preserve once-per-interval root advancement.
- **Breaking continuous control:** retain per-tick move-to, turn, contact, and local-controller resolution as distinct from admission.
- **Inferring lifecycle from runtime allocation:** establish/reconstruct explicitly at actual authority boundaries; lazy runtime allocation is not evidence of creation.
- **Scope growth into physics:** only change eligibility and precedence needed for verified death behavior; prove root/position consequences before changing existing exclusions.

## Definition of done

- [x] Death transition, interruption, corpse establishment, and repeated-tick behavior match the cited references and content.
- [x] Shared authority owns semantics; the renderer uses its existing resolved presentation contract.
- [x] Creation/update/reset distinctions survive the full admission path, including local-player and Explorer integration.
- [x] Regression checks, browser verification, formatting, and clippy pass.
- [x] No untracked-asset unit tests, vestigial lifecycle paths, or unreviewed scope expansion remain.

## Decisions and open questions

### Implementation findings (2026-09-09)

- Census command: `cargo run -p holtburger-debug-harness --bin motion_death_census -- --content dats`. Of 436 tables, 292 have a noncombat dead destination, 291 have a direct Ready→Dead link, 120 destinations differ from a single zero-rate frame, and 43 entry/destination animation pairs differ. Table `0x09000230` has two destination clips; table `0x09000229` has a 4.5-fps destination. Player table `0x09000001` settles on frame 0 of a separate animation. Initialization must preserve the selector's cyclic suffix, not construct a last-frame pose.
- `CSequence::remove_all_link_animations` and `MotionTableManager::HandleEnterWorld` remove prefixes without visiting hooks. `AnimationDone` (317050) drains pending actions and `CMotionInterp::MotionDone` (329942) removes interpreted/raw actions and unsticks. Runtime cancellation must clear active and queued actions together and retire sticky action ownership.
- Successful `upsert_entity_from_create` is the establishment boundary; position initialization alone also occurs during attachment and spatial operations and must not reset animation. Replacement must forget the prior runtime even with the same GUID.
- Accepted remote updates will synchronously select their steady intent and admit their action batch in order. Repeated ticks keep controller/directive resolution but never execute packet interruption effects. No durable packet queue is needed with the bootstrap catalog.
- Local autonomous echoes retain their existing filtering. Server-controlled local death must take precedence over held manual drive while using the same once-per-tick playback owner. Reset of the local motion epoch establishes the replacement stance rather than replaying a transition.
- Table rebinding reconstructs the retained destination against the new table and retires old action clips; it preserves remote directive progress and sticky lifetime as currently specified. This is reconstruction, not new packet admission.
- `contact_allows_move` explicitly permits Dead independent of contact (330154). Keep existing physical death restrictions while allowing authored playback; support reduction must preserve Dead. The existing cyclic-selection operation can serve both locomotion presentation and lifecycle prefix removal after its misleading presentation-only name is replaced.

- Implemented: refactored admission and runtime lifecycle; preserved snapshot data, motion content, and frontend presentation shapes.
- Implemented: no new buffering for unavailable motion tables; explicit diagnostics preserve the existing failure concession.
- Resolved: queued-action cancellation and reset/rebind semantics are documented in the implementation findings above.
- Implementation was explicitly authorized after the plan was written. No open user decision or implementation blocker remains.

### Final implementation and verification evidence

- The user subsequently authorized implementation. `BodyMotionRuntime::establish` selects the destination without its transition prefix; `accept_order` applies fresh admission interruption; `drive` retains continuous selection and advancement for local controls and directed movement. The private selection helper distinguishes admission from continuous selection without adding durable flags or a packet queue.
- `accept_entity_motion`/`accept_remote` replace the separate remote action enqueue path. They apply accepted steady state, cancellation, and actions before returning, then renew packet sticky state. Autonomous local echoes retain their filtering. Local death gives playback ownership to world advancement even while manual drive is held.
- Successful create/replacement calls the establishment path, independently of spatial initialization. Local epoch resets use the same reconstruction primitive. Table changes establish the retained destination while retiring old action clips and retaining directive/sticky state. Explorer's existing continuous `drive` calls remain appropriate; no app policy or host API was changed.
- The completed census found one multi-clip destination, 24 destinations containing nonzero rates, and no negative-rate destinations. Real-content checks exercised the player table, Drudge table, table `0x0900000B`, multi-clip `0x09000230`, and animated destination `0x09000229`. Synthetic tests also cover reverse rates despite their absence in this census.
- Seven synthetic world/runtime lifecycle tests cover establishment, active/queued cancellation, repeated ticks versus repeated admissions, support precedence, table rebinding, reset, and replacement. A core test verifies that held manual drive neither suppresses nor double-advances authoritative death and does not actuate its root offset.
- `death_motion_fixture` runs actual production `ObjectCreate` and `UpdateMotion` handling against mounted content and writes the normal `DynamicEntityMotion` projections plus lifecycle identity. The browser uses real Drudge geometry and its camera-relative anchor; only placement/display are supplied by that anchor. It does not substitute death animation IDs or frames. This is controlled protocol-handler-to-renderer evidence, not a live network kill.
- Browser command: `npm run harness:browser -- --brief --spawn-wcid 192 --spawn-distance 4 --settle-ms 1000 --death-motion-fixture /tmp/death-motion-fixture.msgpack --screenshot /tmp/death-integrated-first.png`. Generate the fixture first with `cargo run -p holtburger-debug-harness --bin death_motion_fixture -- --content dats --output /tmp/death-motion-fixture.msgpack`.
- Both ordinary and first-rendered-frame captures show the new and late-realized corpse already in its dead pose, without an upright frame. The death transition progresses and settles. Browser application error collection is empty; host/runtime resource teardown assertions pass. Captures use SwiftShader, default render scale 1, and are correctness evidence only.
- Final verification: `cargo test -p holtburger-world -p holtburger-core --quiet` passes 715 world and 359 core tests; `cargo test -p holtburger-3d-host --quiet` passes 276 host tests. `npm run test:ts -- src/lib/game/runtime/dynamic-entity-motion.test.ts src/lib/game/runtime/game-presentation-runtime.test.ts` passes 48 tests. App `check` and `lint:ts` pass after first-frame instrumentation. `cargo fmt --all -- --check`, `git diff --check`, and all-target clippy with `-D warnings` pass for world/core/debug-harness/host. Selected frontend files were formatted with the installed Prettier; the package format script targets the entire app, so formatting was scoped to touched files.
- Production changes are approximately +121 net lines; explicit lifecycle operations and ordered admission account for that growth. The old remote action-only path and presentation-only prefix-removal name are gone. Most added lines are synthetic tests and reusable diagnostic tools; no new tests require untracked archives.
- Remaining concessions are unchanged: absent/unmodelled motion content is diagnosed without invented poses or deferred replay, existing physical death restrictions remain, and frontend clock synchronization is outside this change. No outstanding design question remains from Phase 1.
