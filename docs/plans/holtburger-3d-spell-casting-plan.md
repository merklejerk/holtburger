# Shared combat execution and 3D spell casting

Status: implementation and automated verification complete; user accepted the delivered behavior after the contact-interruption fix. Individual acceptance scenarios below are not separately attested.

Implemented: world spell routing; shared combat execution; typed normal/untargeted intent; TUI/script migration; failed-send and lifecycle busy cleanup; host/session forwarding; magic-gated Cast buttons; contact-driven retirement of obsolete animation work. Final review and commit requested by the user.

## Goal and boundaries

Add a Cast button to every known-spell row in the 3D client, backed by shared combat execution that a future spell shortcut bar can reuse.

In scope: shared spell routing, consolidation of existing combat command handling, typed host/session casting, panel controls, existing TUI/script migration, busy cleanup, contact-driven animation interruption, and movement/casting acceptance.

Out of scope: shortcut-bar layout, repeat attacks/casting, queues, auto-targeting, a second selection, new melee behavior, and wholesale movement redesign. No automatic stance entry in the 3D panel. No implementation or commit is authorized by this document alone.

## Ground truth and prerequisite findings

Paths below are repository-relative; retail citations refer to `acclient-eor-source/acclient.c`.

| Source | Finding |
| --- | --- |
| Retail :387433 | Normal casting checks self flag first, then formula-derived zero target type, then selection and compatibility. |
| Retail :429344, :464887, :464934, :464327 | Formula is complete when first five slots are nonzero. Scan subsequent contiguous slots through eight; the last component determines target type through a fixed ID switch. No component-table load is needed. |
| Retail :386534 | Cast submission sends targeted or untargeted action and increments UI busy count. |
| ACE/Source/ACE.Server/WorldObjects/Player_Combat.cs:762 | LastCombatMode is recorded before a potentially delayed stance transition. |
| ACE/Source/ACE.Server/WorldObjects/Player_Magic.cs:84, :275 | Both cast handlers tolerate non-magic current mode when LastCombatMode is magic. FastTick physical-stance checks can still reject. |
| Same file :221, :1142 | Targeted packet resolves an object (fellowship resolves self); untargeted packet constructs a null-target cast. |
| ACE/Source/ACE.Server/WorldObjects/WorldObject_Magic.cs:1695 | A null-target projectile launches along the caster's forward vector. This does not establish universal targetless support for non-projectile spells. |
| Player_Magic.cs:160, :717, :745, :1277 | Server turns toward targets, checks configurable release angle, and resumes casting after completed or cancelled turning. |
| Player_Magic.cs:373, :870, :1336 | Windup displacement limit is six units and these checks exempt NPK players. Movement is not itself an unconditional spell cancellation. |
| core/client/commands.rs:26, :1160 | Existing normalization uses authored targeting, includes a War/self special case, and silently routes missing targets/definitions to untargeted. Busy arms before send. |
| core/client/runtime.rs:78, :96 | Command errors disconnect; busy timeout clears and publishes completion. Send failure currently leaves the armed busy field set. |
| core/client/mod.rs:585 | Shared busy tracker rejects overlap, resolves UseDone and associated errors. It is not a generic combat animation lock. |
| apps/holtburger-cli/src/pages/game/domains/combat.rs:23 | TUI requests magic then casts immediately, with optional SnapFacing. Scripts feed this action too. |
| core/client/movement/system.rs:376 | ManualHeld/ManualPulse replace server-directed movement and require movement publication. This path does not issue spell cancellation or access cast busy state. |

### Fresh data census

Re-ran the temporary `/tmp/spell-tag-census` Rust exporter against local DATs using current ContentRepository/SpellTable decoding. Output: `/tmp/cast-prereq-census.json`. Applied retail's complete-formula/last-component switch independently in Python.

- 6,266 records: 2,083 self, 3,911 selected-target, 272 untargeted under retail branch precedence.
- 46 non-self records disagree on zero/nonzero formula vs authored target type: 45 War, one Life.
- Examples: Flame Wave and Shock Waves have authored target 16 but retail target zero; Sacrificial Edge and Essence Bolt have authored zero but retail target 16.
- Zero self records have authored target zero. Self-first remains the source-defined rule, not a corpus-dependent shortcut.
- Census is local evidence, not an exhaustive claim about server-custom spellbooks. No runtime-asset-dependent tests will be committed.

The earlier suggestion that another component table was necessary was incorrect: retail uses a fixed switch. Preserve decoded slots; do not use account-customized display formulas to derive casting routes.

### Movement verification and limits

Ran `cargo test -p holtburger-core server_approach_manual_takeover_bypasses_matching_publication_history --lib`: passed. Together with source tracing this proves existing takeover publishes even when ordinary publication history matches. It does not prove live spell turning end to end. That remains an explicit interactive acceptance gate owned by the user, not an unresolved architecture choice.

## Contracts and north stars

- World owns pure spell route semantics; core owns execution; host forwards; frontend owns selection and controls.
- One selection only. Capture its ID when the user clicks. Later selection changes affect later requests.
- Use one semantic cast command with a typed aim intent: `Normal { selection: Option<Guid> }` or `Untargeted`.
- Normal resolves self first, formula untargeted second, otherwise requires non-null selection. Missing definitions produce a specific rejection. Explicit Untargeted bypasses recipient substitution and sends an untargeted packet; server decides applicability.
- Reject unknown spells locally where known-spell membership is available for ordinary spellbook casting. Do not extend this API to item-bound spells in this slice.
- Do not enforce confirmed magic stance globally in core. Preserve TUI/script immediate stance-then-cast sequencing; ACE decides transition readiness. The 3D UI requires confirmed magic and in-world lifecycle.
- No duplicate stance, selection, or combat-busy field. No pending stance/cast queue.
- Manual movement takes control without sending CancelAttack, changing stance, clearing busy, or declaring casting failed. Subsequent server motion remains authoritative input.
- Server enforces resources, range, facing and target legality. Full retail client compatibility preflight is deferred; missing normal selection is a local error.
- General busy overlap, equipment and inventory conflicts return visible rejection and preserve the existing operation.

## Phase 1: Shared spell semantics and command cutover

- [x] Add pure casting-route resolution beside `world/src/spell.rs` / `spell/formula.rs`, using retail fixed component mapping and complete-formula behavior. Model self, untargeted, and selected-target explicitly.
- [x] Replace both existing core casting commands with one typed intent. Keep protocol packet variants unchanged.
- [x] Introduce `core/client/combat_runtime.rs`; delegate stance, cast, existing attacks and cancellation from commands.rs. Preserve existing stance/equipment transaction ownership and attack behavior.
- [x] Remove old normalization and its War/self rewrite; update callers and tests in the same phase.
- [x] TUI/script supplied target maps to Normal; absent target maps to explicit Untargeted, preserving their targetless capability. Preserve automatic stance request. Keep TUI facing policy unchanged in this slice; do not copy it into 3D.
- [x] Preserve existing masked spell-ID semantics deliberately; validate/resolve the canonical ID and send the canonical spell identity.

Acceptance: fixture tests cover all fixed target-component groups, incomplete formulas, self precedence, missing definition/selection, explicit untargeted with a selected/self spell, and TUI/script sequencing. Existing attacks and equipment restoration pass their focused tests. No legacy casting command callers remain.

## Phase 2: Execution lifecycle

- [x] Reuse shared SpellCast busy acquisition and UseDone resolution. Return visible overlap rejection before acquisition.
- [x] Ensure failed submission releases the newly acquired busy operation and publishes idle while propagating the transport failure. Never clear an unrelated operation.
- [x] Clear pending busy state at character/session teardown and new-character entry through an appropriately shared lifecycle helper. Include normal logout, server disconnect, timeout and runtime failure paths; do not silently synthesize successful completion.
- [x] Preserve timeout behavior; do not add correlation/queue semantics unsupported by UseDone.
- [x] Test server failure, pending error followed by UseDone, timeout, send failure, overlap, teardown and character replacement. New connections must not display stale busy state.

Acceptance: each terminal path has a test proving state and emitted feedback; equipment/pack operations retain conflict protection. A late uncorrelated UseDone cannot be solved perfectly by adding a local cast ID: document this existing protocol limitation, and keep single-flight semantics.

## Phase 3: Host, frontend and panel

- [x] Add typed cast command to client_runtime host dispatch and transport allowlist. Forward spell ID and aim intent without re-deriving spell routing.
- [x] Add one frontend casting action shared by panel and future shortcut bar. Read selection at invocation and send Normal intent.
- [x] Add sibling Cast button to each spell row; do not nest it inside the expand button. Preserve expansion/search/icon ownership.
- [x] Enable only for confirmed magic in active gameplay with usable spell identity; provide an explanatory disabled label/title. Handle invocation failure through existing feedback.
- [x] Keep selection and stance lifecycle state under existing owners. No reactive movement feed or separate combat service state.
- [x] Update host/session fixtures, showcase and panel harness. Tests cover disabled states, click payload, selection changes, self/untargeted normalization in core, resync and teardown.

Acceptance: typed transport checks pass, button and expansion remain independent, and the future bar can invoke the same action without importing panel internals.

## Phase 4: Integration, cleanup and acceptance

Acceptance ownership: the agent owns implementation, automated checks, code review, and a focused handoff checklist. The user owns all visual and interactive acceptance gates, including live casting and movement. The agent does not run those gates or treat their absence as a reason to stop implementation or automated verification. Report them as pending user acceptance until the user supplies results.

- [x] Exercise cast request followed by manual movement in a synthetic core test: movement publication occurs and cast busy remains until server completion. No spell cancellation packet is emitted by takeover.
- [x] Run scoped Rust tests/Clippy with warnings denied and app manifest scripts for TypeScript tests, check, lint and dead code. Use existing package scripts and formatting conventions.
- [x] Sweep replaced command names, stale comments and tests. Keep movement, equipment and feedback in their rightful owners; avoid cosmetic migration of unrelated code into combat.
- [x] Agent: complete code review and hand off a focused visual and interactive acceptance checklist with automated verification results.
- [ ] User visual acceptance: Cast button placement, disabled-state explanation, row expansion independence, and visible rejection feedback.
- [ ] User interactive acceptance: self buff with enemy selected; targeted spell with target ahead/behind; normal missing target rejection; naturally untargeted spell with selection; explicit targetless projectile through script; move during windup/automatic turn; change selection during windup; repeated clicks; stance swap and equipment conflicts; reconnect/reset.
- [ ] If live takeover fails, diagnose movement directive admission/publication and ACE completion before adding combat-specific controls. Do not assume packet success implies spell release.

## Risks and concessions

- Retail routing differs from authored ACE validation: use retail normal routing and preserve explicit untargeted intent. Rejection remains server feedback, not a silent routing rewrite.
- Delayed stance transitions can still reject or interrupt immediate casts. Preserve server behavior; no guaranteed automatic-entry success is promised.
- Busy timeout permits a later request before a delayed UseDone; no wire correlation exists in the current tracker. Queued casting is deferred.
- Cross-client command cutover is broader than the button but prevents a second casting implementation. Attack mechanics and TUI facing remain unchanged.
- Static source/tests establish the design; the user owns live visual and interactive acceptance.

## Definition of done

All phases pass; the panel casts through the shared path; explicit untargeted remains available; no duplicate selection/stance/busy state exists; manual movement does not locally cancel spells; terminal cleanup is verified; scoped lint/type/test checks pass; user acceptance findings are resolved. No commit without a separate request.

The agent's implementation handoff is complete after implementation, automated verification, code review, and delivery of the acceptance checklist. Visual and interactive acceptance remain separately pending with the user; do not claim those gates passed without user confirmation.

## Open questions

None required to begin implementation. Live server outcomes are acceptance tests rather than policy decisions deferred to the implementer.

## Implementation evidence and review

- `cargo test -p holtburger-core -p holtburger-world -p holtburger-3d-host --lib`: 455 core, 811 world, 309 host tests passed. Loopback and failed-send tests require local UDP permission; the initial restricted run failed at socket binding, and the permitted run passed.
- `cargo test -p holtburger-cli combat`: 59 tests passed; no interactive TUI was launched.
- `npm run test:ts`: 297 files, 2,393 tests passed.
- `npm run check`: Svelte, application/test, node and Electron type checks passed.
- `npm run lint:ts`, `npm run lint:dead`: passed.
- Scoped Clippy across world/core/CLI/3D host with `--all-targets -- -D warnings`: passed. Final busy-overlap simplification received a focused regression rerun.
- Formula tests cover all retail switch groups, contiguous lengths five through eight, incomplete input and trailing gaps. Core tests cover canonical IDs, selection/self/untargeted routing, missing input, known-spell rejection, immediate stance/cast, busy overlap, error completion, timeout, failed-send idle publication and new-character cleanup.
- Combined synthetic cast/turn/manual-input test decodes actual captured session packets: initial cast followed by movement only; manual control replaces the server turn; SpellCast stays busy until UseDone.
- MessagePack host test verifies the actual `spellId` spelling and both aim variants. Review caught and corrected an initial snake/camel case mismatch.
- Frontend session tests cover current selection payloads, stance replacement and stopped-session rejection. Review added the stopped-session guard. Panel enablement and sibling-button markup were inspected; visual/interactive behavior is intentionally unclaimed until user acceptance.
- Reviewed accumulated diff from world semantics through core dispatch and operation teardown, host decoder, transport allowlist, session and panel. Existing equipment conflict checks remain at the shared dispatcher; equipment restoration remains equipment-owned. No new retained combat state or duplicate selection was introduced.
- Removed obsolete casting command variants, authored-mask normalization and War/self rewrite. Explicit targetless TUI/script calls now remain explicitly targetless, including self spells; ordinary self casting uses Normal intent. This is the planned distinction, not a claim that every targetless spell succeeds on ACE.

### User acceptance handoff

1. Open Spells in peace: Cast is disabled with an explanation. Enter magic: buttons enable. Confirm search filters and row expansion still work independently.
2. Select another object, then cast a self spell and a naturally untargeted spell. Verify selection does not redirect either.
3. Cast a normal targeted spell with a target ahead, then behind. Without selection, verify the clear missing-target feedback.
4. During windup/server turning, press movement/turn keys and change selection. Verify manual control responds, the client does not cancel the spell itself, and ACE determines the outcome. The next cast should use the new selection.
5. Through a script, deliberately cast a projectile without a target; verify forward casting. Check repeated clicks, equipment changes, leaving magic, and reconnect/character change for clear feedback and no stale busy state.

The user accepted the delivered behavior after the contact-interruption fix. This checklist records the suggested coverage, not a claim that every scenario was individually exercised.

### Contact interruption and final review

- Retail walkable-bit transitions (acclient.c:306805, :330655, :330680) remove unfinished link animations for gravity-enabled creatures; HandleEnterWorld (:317294) drains them as failed work. The world motion runtime now applies that interruption on takeoff/landing, including launch and landing within one integration collection.
- Interruption reuses the existing death-path retirement primitive. It skips obsolete hooks, releases action-owned sticky state, and preserves admission history. It does not report successful action completion or touch core spell busy state.
- Regression coverage includes walkable edges, repeated contact levels, hydration, non-creatures, gravity exemptions, fresh subsequent actions, skipped hooks, public contact events, and spell busy ownership through contact changes. Full scoped Rust tests and Clippy passed after the fix.
- The user reported “lgtm” and explicitly prefers being able to jump mid-cast. Preserve current jump admission; adding retail pending-motion jump restrictions (acclient.c:330177, :329576) is outside this change. Spell success remains server-owned.
- Final code-quality review covered the accumulated diff against HEAD, including new files, TUI/script callers, host MessagePack decoding, frontend session/panel, busy teardown, and world contact interruption. No remaining blocking findings. Future spell shortcuts can reuse the session action without another state owner; no general combat controller is warranted by this slice.
- Accepted limitations: uncorrelated late UseDone remains a protocol limitation; TUI/script absent-target intent stays explicitly untargeted; automated checks do not establish every live server outcome. No additional visual or interactive gates were run by the agent.
