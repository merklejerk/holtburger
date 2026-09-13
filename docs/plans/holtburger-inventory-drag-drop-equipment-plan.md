# Inventory drag-and-drop and shared equipment orchestration

Status: implementation and automated validation complete; visual/interactive acceptance belongs to the user. Live ACE execution was not performed because probe credentials are unavailable.

## Context and boundaries

Deliver native inventory drag-and-drop in holtburger-3d and reliable equipment replacement through one core-owned operation controller shared with the TUI.

In scope:

- Inventory insertion, cross-container moves, partial/full stack merging, and header append.
- Equip and unequip through drag-and-drop, including multi-item equipment conflicts and storage allocation.
- Native pack ordering and exact pack swaps.
- Replace the TUI's existing equipment sequencing and core's unchecked automatic unequips.
- Core-owned command sequencing and authoritative completion, existing action feedback for failures, and focused automated verification.

Out of scope: loadout persistence/editor/activation UI, general workflow frameworks, automatic rollback, ground/trade/vendor drops, unrelated inventory UI expansion. Stack splitting was added by subsequent user steering. Future loadouts motivate reusable conflict-resolution and storage-allocation functions; a public multi-assignment request API is out of scope until it has a production consumer.

## Agreed interaction contract

| Source and target | Behavior | Non-native contents sorting |
| --- | --- | --- |
| Inventory item → compatible stack with room | Merge as much as fits; remainder stays in source | Allowed |
| Inventory item → compatible full stack | Fall back to insertion before the target | Blocked |
| Inventory item → other contents cell | Insert before target entity in its native container sequence | Blocked: “Switch to Native sorting to place items” |
| Inventory item → container header | Append in that container's native sequence | Blocked |
| Inventory item → compatible equipment slot | Resolve conflicts, unequip them, then equip | Allowed |
| Equipped item → contents cell | Same merge/insertion target semantics as inventory items | Append to the target cell's container |
| Equipped item → container header | Unequip and append | Allowed |
| Real pack → another real pack in strip | Exchange their native pack indices | Allowed |

Self-drops are no-ops. Main pack and foci are fixed strip entries, not reorder sources/targets. Empty strip cells are not swap targets in this scope. A contents cell representing a container still means insertion into that cell's parent; its header means insertion into the container itself.

Do not change sort mode automatically. Unknown facts must produce pending/unavailable eligibility, not a guessed move or merge. A compatible stack with no room falls through to insertion only when the intent permits movement. Explicit drops into a full container fail rather than silently choosing another container; fallback storage selection is for displaced equipment and stack splits.

“Before target” is identity-based: `[A,B,C,D]`, A dropped on C, becomes `[B,A,C,D]`. Resolve placement after accounting for source removal. Append after the highest remaining native index in the applicable item/pack domain, not after the displayed array index. Inventory order and pack order are separate domains.

Strip presentation is Main Pack first, real containers in native pack-index order, then foci in native order. Empty capacity remains visible without being mistaken for native contiguous positions. Contents sorting never changes strip order. Preserve actual indices through display grouping.

## Ground truth and current implementation

All paths below are repository-relative. Confirm line numbers and behavior against current sources during implementation.

| Source | Evidence or responsibility |
| --- | --- |
| `ACE/Source/ACE.Server/Network/GameAction/GameActionType.cs` and `Actions/GameAction{PutItemInContainer,StackableMerge,GetAndWieldItem}.cs` | Existing wire requests: move `0x0019`, merge `0x0054`, wield `0x001A` |
| `ACE/Source/ACE.Server/WorldObjects/Container.cs`, `TryAddToInventory`, `TryRemoveFromInventory` | Remove closes source gap; insert shifts destination occupants; item and pack domains are independent |
| `ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs`, `DoHandleActionPutItemInContainer` | A container move also unequips; server operations are not a general transaction |
| Same file, `HandleActionStackableMerge`, `DoHandleActionStackableMerge` | Matching template and stackability checks; explicit positive quantity; no automatic overflow clamp |
| Same file, `DoHandleActionGetAndWieldItem`, `CheckWeaponCollision` | Client clears most conflicts; server has special weapon behavior and wield requirements |
| `ACE/Source/ACE.Server/WorldObjects/Creature_Equipment.cs`, `GetEquippedItems` | ClothingPriority conflicts, weapon placement, and equipment masks are distinct concepts |
| `acclient-eor-source/` | Authoritative client behavior for equipment targeting, combat transitions, and ordering; locate exact `acclient.c` routines before asserting retail behavior |
| `crates/holtburger-world/src/state/storage.rs` and `handlers/inventory.rs` | Existing authoritative insertion/removal reconstruction and containment events |
| `crates/holtburger-world/src/context.rs`, `resolve_merge_stack_amount`, `find_non_full_pack` | Reuse/strengthen shared merge and storage predicates; current pack helper does not reserve an entire operation's capacity |
| `crates/holtburger-core/src/client/commands.rs`, `resolve_and_clear_slots` | Current conflict-mask loop sends displaced items to main-pack position zero without capacity allocation or authoritative waits |
| `crates/holtburger-core/src/client/messages.rs`, `types.rs` | Inventory rejection retains item identity through `ActionResultReason::InventoryServerSaveFailed` |
| `apps/holtburger-cli/src/pages/game/weapon_swap.rs` and `domains/inventory.rs` | TUI owns combat-mode staging; inventory reducer uses shared commands |
| `apps/holtburger-3d/src/client/client-inventory-{state,sections,equipment}.ts` | Cached inventory projection, capacity-based pack sorting, display equipment masks |
| `apps/holtburger-3d/src/client/client-entity-mirror.ts` and `crates/holtburger-world/src/entity_facts.rs` | Existing quantities, template IDs, allowed locations, capacities, and native positions; not a complete operation-eligibility contract |
| `apps/holtburger-3d/host/src/client_runtime.rs`, `client_projection.rs`, browser host contracts, `electron/host-protocol.ts` | Narrow host boundary and serialization/validation integration |
| `apps/holtburger-3d/src/client/{ClientInventoryPanel,InventoryEquipmentStrip}.svelte`, `src/app/ItemGridCell.svelte` | UI interaction integration |

Source inspection established the broad behavior; live server execution has not yet verified these operations. A single request does not imply rollback guarantees. Do not change the retail decompile. Use ACE/ACViewer as applicable for further proof, and mark intentional retail quirks/divergences only with the required citations and census.

## Data shapes to establish before choosing algorithms

Phase 1 must record the relevant shapes and bounds from source guarantees and available representative inventories. Separate observed examples from guarantees; do not infer general support from one character.

- Inspect the complete pack sequence, including foci. Containers at indices 0, 2, and 5 may have intervening foci rather than actual holes. Classify complete dense sequences, genuine holes, and incomplete hydration separately.
- Establish container counts/capacities and the number and kinds of equipment conflicts encountered by a single replacement. Prefer straightforward bounded scans and a temporary capacity map; introduce more elaborate allocation only for a demonstrated constraint.
- Identify which compatibility facts are public, which require hydration, and which wield requirements remain server-authoritative. Missing data needed to plan safely is distinct from inability to predict every server rejection.
- Trace action-result correlation and world-update ordering, including late and duplicate updates, before selecting execution states or retry behavior.

## North stars and ownership

- One owner for equipment execution, including required combat-mode sequencing. Remove competing owners and unchecked paths.
- World owns authoritative compatibility, conflicts, storage semantics, and availability. Core owns reusable planning/execution. Frontends own gestures, sorting, highlights, and destination preferences. Host code is a typed adapter.
- Compute derived facts at their owner and transport the result. Do not repeat equipment rules in Svelte/TypeScript validators.
- Use a pure planner and a small explicit executor state machine; no general transaction engine.
- The public equipment request describes one item and its intended wield location, not frontend-generated unequip packets. Keep conflict resolution and storage allocation pure and reusable; do not add a public multi-assignment API for hypothetical loadouts.
- Prefer deletion/unification. Estimate added production lines per phase and justify new abstractions by named consumers.

## Operation design and concessions

Equipment planning resolves the actual wield location, all conflicts (deduplicated by identity), and storage destinations before sending any mutation. Display masks alone cannot establish these facts. Clothing coverage and weapon/offhand/ammunition rules need their own authoritative evidence.

Compatibility is not permission to equip. Resolve slot compatibility, conflicts, and capacity locally, and check established local blockers before any unequip. Do not reproduce the complete server wield-requirements system. A positive preview means the locally known plan is feasible; ACE may still reject the final equip. Missing essential conflict/capacity facts blocks planning, while a server-only requirement remains an accepted source of partial failure.

Displaced-item destination preference: incoming item's container, then main pack, then other carried containers in native pack order. Allocate append positions and account for all displaced items in a temporary remaining-capacity map owned by this plan. “Reservation” means this local arithmetic, not a persistent reservation service or resource-lock manager. Do not credit the incoming item's occupied cell before it is equipped. Initially reject plans that cannot accommodate the unequip-first sequence, even when the final inventory would fit.

The executor observes accepted world state, not successful socket writes. Revalidate the remaining plan before each step. Stop on relevant rejection, timeout, incompatible external mutation, disconnect, or lifecycle invalidation. Report completed work and the failed/pending outcome; timeout means completion is uncertain, not proof the server did nothing. Do not automatically roll back or retry a possibly completed mutation.

Allow only one active equipment change initially; reject another request as busy rather than queue stale intent. Use a narrow core command gate for inventory mutations that conflict with the active plan, so local moves cannot consume its allocated capacity. Identify the actual conflicting command families during caller tracing; do not introduce a general lock system. Avoid locking unrelated chat, movement, or selection. Incoming server changes remain authoritative and may invalidate a plan. Observe late events after termination without restarting the operation.

Combat-mode prerequisites and restoration belong to the same execution owner. Preserve intentional TUI behavior through an explicit request policy where appropriate; do not automatically copy its timeout fallback. Manual combat-mode changes must not be overwritten by stale restoration intent.

Pack swap execution uses the same reliable command/result plumbing where useful, but is not an equipment operation. Two insertions can exchange endpoints of a contiguous sequence. First distinguish gaps in the displayed container subset from genuine holes in the complete pack sequence. Prove swaps across intervening foci using that complete sequence; only then investigate actual holes demonstrated by sources or observations. Insertion/removal shifts can change intervening positions, so verify their final positions as well as both endpoints. Do not promise exact sparse-index preservation until the sequence is demonstrated. If two moves cannot fulfill the requested invariant, derive a bounded sequence or bring that concrete tradeoff back before weakening the requirement.

### Preview and submission flow

The browser interprets the gesture and applies app-local sort restrictions. It submits source/target identities and destination preference through a narrow typed preview request. Core evaluates that intent using world-owned semantics; the same evaluator supplies execution planning on submission. Return only the resolved action/eligibility and explanation needed by the active drag consumer, with enough request/session identity to discard stale responses.

Request previews on semantic source/target changes, not every pointer movement. Re-evaluate affected previews when their world facts change; pending feedback is explicit while a result is unavailable. A drop submits intent, not an executable plan cached by the browser, and core evaluates it against current state before any mutation. Do not publish an all-pairs compatibility matrix, duplicate authoritative rules in TypeScript, or treat a preview as a server guarantee. Phase 1 must settle how current host events invalidate previews without adding a second inventory subscription system.

## Phased implementation

### Phase 1 — Prove semantics and settle contracts

- [x] Trace exact ACE and retail routines for wield targeting, clothing conflicts, weapon/ammo interactions, combat transitions, and equipped-stack merges.
- [x] Record the data-shape census above. Verify source-removal indexing, header append, full-container same-container reorder, and pack swaps across foci with a small deterministic simulation against ACE rules. Investigate genuine holes separately from filtered indices and pending hydration.
- [x] Inventory existing core command callers, TUI swap state, busy-operation handling, lifecycle hooks, and host result delivery.
- [x] Define a typed single-item equipment request, resolved plan/steps, preview eligibility, and terminal feedback through the existing action-result channel. Specify preview invalidation, stale-response rejection, and submission through the same shared evaluator. Distinguish unavailable facts, invalid requests, busy state, and server rejection.
- [x] Determine which required facts arrive publicly and which require identification/content hydration. Define an explicit pending path for essential planning facts, and list which server-only wield requirements are deliberately not predicted.

Acceptance: every branch has a source citation or focused reproduction; sparse-swap semantics and failure correlation have an executable strategy; no implementation-dependent user question is hidden as an assumption.

### Phase 2 — Shared semantics and planning

- [x] Strengthen/reuse world stack compatibility and transfer amount calculation; reject self-merge and unestablished identities/stackability.
- [x] Add authoritative equipment conflict/target resolution, covering clothing and weapon exceptions without using strip masks as the conflict model.
- [x] Implement pure storage allocation using a temporary capacity map and single-item equipment planning in the owning layers. A whole plan either has sufficient known capacity or produces no commands.
- [x] Implement identity-based insertion, append, and proved pack-swap planning using existing storage semantics.
- [x] Add focused unit tests for merge limits, forward/backward moves, separate slot domains, full-container reorder, sparse indices/foci, multi-slot conflict deduplication, and reservation exhaustion.

Acceptance: plans are deterministic, source-backed, and side-effect free; all displaced items have valid reserved destinations; insufficient/unknown capacity cannot produce partial execution.

### Phase 3 — Core execution and TUI cutover

- [x] Introduce the core equipment owner and drive it from accepted world changes, action failures, lifecycle events, and time.
- [x] Route equip commands through this owner and remove `resolve_and_clear_slots`; `SplitToWield` also uses the shared plan and executor.
- [x] Transfer required combat sequencing from TUI `weapon_swap.rs`; frontend-specific policy remains an explicit frontend choice.
- [x] TUI equip dispatch delegates to core; obsolete local state/ticks/tests and vocabulary have been removed. Core retains execution state and reports failures through existing action feedback.
- [x] Integrate reliable pack-swap execution and operation coordination without broadening equipment into a generic workflow engine.
- [x] Test delayed/duplicate world updates, rejection after an earlier successful unequip, stale plans, timeout/late success, disconnect, manual combat changes, and concurrent requests.

Acceptance: both direct and TUI equip entry points have one execution authority; no wield request precedes confirmed conflict removal; failed steps cannot trigger later steps; partial outcomes are visible.

### Steering checkpoint

- [x] Reassess source findings, line growth, boundaries, and remaining debt. Walk a 3D drop end-to-end through the actual new API.
- [x] Verify that conflict resolution and storage allocation are reusable pure functions, with only the demonstrated single-item public request. Remove speculative loadout contracts or reservation infrastructure.
- [x] Adjust remaining phases if protocol correlation, hydration, or sparse positions changed the design. Escalate only a concrete unresolved product tradeoff.

### Phase 4 — Typed 3D adapter and drag interaction

- [x] Add narrow host requests and preview results through Rust dispatch, Electron transport/preload, browser contracts, and validators; follow actual current transport paths rather than assuming Tauri commands.
- [x] Wire semantic-target preview requests to the shared evaluator and re-evaluate submission in core. Publish only eligibility/facts needed by the active drag consumer; use composite shapes where fields depend on each other. Test stale responses, target changes, and world-fact invalidation.
- [x] Add session-scoped drag identity, target feedback, and cancellation. Resolve final intent against current facts at drop, not a captured array position.
- [x] Implement the interaction table, native-sort rejection reason, full-stack behavior, header append, and fixed main-pack/foci rules.
- [x] Replace capacity sorting with native pack ordering and explicit foci grouping.
- [x] Suppress click/double-click activation after a drag; ensure drag input does not move the camera, panel, or world character. Handle panel closure/session change and content scrolling.
- [x] Keep cursor-rate drag visuals imperative and retain only transient gesture/preview state in the panel. Submission is fire-and-forget; accepted host state owns contents/equipment display, and existing action feedback reports failures.

Acceptance: all agreed source/target/sort combinations dispatch the intended request or a specific rejection; no browser consumer duplicates authoritative conflict logic; failure feedback survives the host boundary.

### Phase 5 — Integration verification and cleanup

- [x] Exercise real pointer drags with `npm run harness:browser -- ...`, extending `src/harness/browser/client-inventory-probe.ts` and synthetic fixtures as needed.
- [x] Verify both sort restrictions and accepted operations, pointer cancellation, multi-slot highlighting, pack/foci ordering, and failures without optimistic state sticking.
- [x] Live prerequisite checked: `HOLTBURGER_PROBE_ACCOUNT` and `HOLTBURGER_PROBE_PASSWORD` are unset. Live ACE execution is not claimed; the user owns interactive acceptance. No interactive TUI was run.
- [x] Remove temporary asset-dependent tests, obsolete equipment machinery, duplicate helpers, dead contracts, and replaced vocabulary. Preserve useful asset-independent fixtures.
- [x] Update relevant durable architecture/protocol documentation for established contracts and behavior; do not maintain unrelated historical plans.
- [x] Review the final diff for ownership, type invariants, complexity, and justified line growth.

Acceptance: browser checks cover production drag wiring; core/TUI integration tests cover the shared owner; no duplicate equipment execution path remains.

## Validation and definition of done

- [x] Run focused Rust tests for changed world/core/CLI/host behavior, then affected-crate tests and `cargo clippy` with `--all-targets -- -D warnings`; run `cargo fmt --all -- --check`.
- [x] In `apps/holtburger-3d`, run the existing `npm run test:ts`, `npm run check`, `npm run lint`, and `npm run build` scripts, plus applicable formatting checks. Scope repeated tests to new changes or unresolved failures.
- [x] All interaction-table cases, equipment failure paths, storage reservations, and sparse swap guarantees have meaningful verification.
- [x] TUI and 3D use the same equipment authority; protocol and host layers contain no frontend sorting/gesture policy.
- [x] Completion follows authoritative state, and partial/uncertain outcomes are reported honestly.
- [x] No runtime-asset-dependent permanent tests, unrequested commits, or retail-decompile modifications.
- [x] Document actual validation results and any remaining limitations before declaring implementation complete.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Equipment conflicts require more than mask overlap | Prove clothing, hand, and ammo rules; calculate once in shared semantics |
| Facts are incomplete when the user drops | Explicit pending eligibility; hydrate through established paths |
| Server failure occurs after earlier changes | Stop, report partial progress, preserve authoritative state; no automatic rollback |
| Failures lack a unique wire operation ID | One coordinated local operation, identity/state correlation, explicit deadlines; do not invent server acknowledgements |
| Snapshot-based capacity goes stale | Reserve within the plan, coordinate local writes, revalidate before each step |
| Filtered container indices are mistaken for holes | Census the complete pack/foci sequence; prove dense swaps first and genuine holes separately |
| Existing TUI combat staging races core equipment | One owner, explicit restoration policy, remove obsolete TUI executor |
| Loadout ambitions overgrow this change | Single-item public request and reusable pure functions; no multi-assignment API or persistent reservation service |
| Preview disagrees with execution | One shared evaluator, stale-response rejection, and fresh evaluation on submission |
| Local compatibility is mistaken for server permission | Check known blockers; document server-only requirements and accept final equip rejection |

## Open questions and execution decisions

No user decision blocks drafting. The agreed interaction table is the product baseline.

### Phase 1 evidence collected

- ACE `Container.cs:175` normalizes the complete pack domain on inventory load, including foci. Container-only indices can therefore be noncontiguous in a dense complete roster. `TryAddToInventory` accepts explicit placement without clamping it, so genuine holes still deserve coverage.
- The exact swap is two requests: source to target's original index, then target to source's original index. A standalone simulation of ACE remove/insert rules passed 14,670 ordered cases (all subsets of positions 0–9 with 2–6 occupants, every distinct source/target pair). Intermediate occupants return to their original indices, even with holes. A permanent world-storage regression covers both directions, intervening foci, genuine holes, and the unaffected item domain; `cargo test -p holtburger-world two_pack_moves_exchange_indices_without_moving_intervening_foci` passed.
- `hydration.rs:141` already imports public description priority into `ClothingPriority`; no new catalog-only clothing-conflict data path is needed. Full classification and completeness requirements still need tracing.
- Retail `acclient.c:419143` (`ACCWeenieObject::UIAttemptWield`) distinguishes ordinary wield from split-to-wield. `419176` begins container-move handling and `419222` begins merge handling. These routines record request identity/time rather than supplying a transactional equipment primitive.
- ACE `WorldObject.cs:75–83` distinguishes shield through CombatUse, two-handed weapons through WeaponSkill (with an explicit warning about old ValidLocations), and launchers/casters through DefaultCombatStyle. The new conflict resolver must not collapse these into allowed-location masks.
- Retail `CPlayerSystem::AutoWearIsLegal` (`acclient.c:380110`) checks clothing priority separately from valid locations; `gmPaperDollUI::ServerSaysMoveItem` (`212106`) maintains both masks independently. This corroborates the shared conflict model rather than strip-mask overlap.

### Implementation and validation so far

- Strengthened `WorldContextExt::resolve_merge_stack_amount` in place: reject self-merge, missing template identity, unestablished stackability, and missing/nonpositive quantities. Preserve `Some(0)` for a full compatible target. This also fixes the TUI's existing consumer without introducing another merge path.
- `cargo test -p holtburger-world context::tests`: 17 passed, including the new transfer-limit and incomplete-data regression. Pack-swap world regression passed separately. Equipment ownership, host preview/submission, frontend drag handling, full lint checks, and runtime verification remain outstanding.
- Added `world/equipment.rs` with public-fact conflict resolution and exact requested-location resolution. It distinguishes thrown weapons from launchers, examines the existing main hand when targeting offhand, compares clothing priorities, expands apparel to complete coverage, and requires a single jewelry side. Four focused tests pass; world all-target Clippy passes with warnings denied. This module is the shared semantic foundation; core command/executor integration is still pending, so the runtime TUI behavior is not yet changed.

### Equipment conflict inputs — resolved with user approval

Further tracing found that exact ACE conflict prediction cannot simply wait for all the server's classification properties to hydrate:

- ACE `WorldObject.cs:75–83` defines launcher/caster classification using `DefaultCombatStyle`, and two-handed classification using `WeaponSkill`. These classifications affect conflict clearing in `Player_Inventory.cs:1878`, not just final wield admission.
- `DefaultCombatStyle` lacks `AssessmentProperty` in `ACE.Entity/Enum/Properties/PropertyInt.cs:76`. `AppraiseInfo.BuildProperties` (`Network/Structure/AppraiseInfo.cs:342`) selects assessment properties, and the public description does not transmit default combat style. An identify request therefore cannot supply this missing input. Weapon skill does arrive in the appraisal weapon profile, retained as `Entity.weapon_profile`.
- The optional local template catalog contains default combat style, but current world bootstrap exposes only its type index. A catalog template would also not prove a live customized item's current server property.
- Retail uses a different, available contract: `ACCWeenieObject::BlocksUseOfShield` (`acclient.c:378448`) checks public combat use, ammo type, and item-type caster bit. `CPlayerSystem::AutoWieldIsLegal` (`380004`) and `AutoWield` (`381564`) use those public facts to predict legality and initiate conflict clearing. Public CombatUse and AmmoType already hydrate in `world/hydration.rs`.

Accepted decision: explicitly use the source-backed retail public-fact rules for hand conflict prediction, refine with authoritative appraisal facts when available, and accept a terminal server rejection for cases where server-only classification disagrees. Keep clothing priority and native storage planning authoritative as already specified. Do not require the optional catalog, silently assume server-only properties are absent, or leave normal equipment requests permanently pending. The user approved this boundary after reviewing the TUI derivation. Exact reconstruction of private ACE classification is not required; this is no longer a blocker. The existing TUI mask heuristic will be replaced, including its incorrect incoming-item check for offhand conflicts and its conflation of thrown weapons with launchers.

Phase 1 must resolve technical questions from sources/experiments: complete pack-sequence shapes and exact swap behavior, authoritative clothing facts and hydration, equipped partial-stack merge behavior, combat restoration rules, preview invalidation, and failure correlation/lifecycle integration. Record evidence and decisions here during execution. If the server prevents the requested exact swap or another agreed behavior, present the reproduced constraint before changing the contract.

### Core executor and TUI cutover progress

- Added `client/equipment_plan.rs`: resolves one requested assignment, deduplicates conflicts by entity identity, and allocates every displaced item before mutation. Allocation checks source pack, main pack, then native pack order; unused unhydrated fallback packs do not block sufficient known storage. Full-inventory replacement does not credit the incoming item's future free slot.
- Added `client/equipment_runtime.rs`: one in-flight request, per-step deadline, authoritative containment/equipment confirmation, remaining-plan revalidation, and peace/wield/combat-restoration stages. Server rejection, manual combat commands, exit, and world activation terminate the owner without rollback. Split-to-wield has a distinct new-entity completion predicate.
- Routed core GetAndWield/SplitToWield through this owner. Deleted the old unchecked conflict-mask loop and the TUI's local executor; the TUI submits the original item/target intent directly. Conflicting local inventory commands are rejected while the owner is active.
- Updated core/CLI architecture docs. Runtime feedback uses the existing action-result channel. Operation state stays in core; the inventory panel does not subscribe to it.
- Verification: core/CLI library suites passed (417 core, 350 CLI at that run); after additional focused regressions, all 9 equipment planner/executor tests passed. Core/CLI all-target Clippy passes with warnings denied. No interactive TUI was run. Full remaining verification includes manual combat/restoration and split completion cases, broader mutation coordination, browser wiring, pack-swap execution, and live ACE checks.

### Inventory request path and first pointer integration

- Added the shared inventory evaluator with identity-based before-item insertion, explicit-container append, partial/full merge handling, exact pack swap plans, and native-domain/capacity validation. Five focused planning tests cover forward/backward full-pack moves, explicit full-container rejection, partial/full merges, sparse pack/foci positions, and merge-only admission.
- Added a semantic merge-only target. The frontend selects it for sorted contents; core cannot reinterpret that request as movement if stack facts change between preview and submission. This keeps sort policy in the frontend while closing the preview/submission race.
- Added serialized native move/merge/pack-swap execution. Merges require both source and destination consequences, and a pack exchange checks the target's expected intermediate location before issuing the second move. Three focused runtime tests cover uncertain timeout, intermediate target movement, and two-sided merge confirmation. Equipment and ordinary inventory mutations mutually exclude one another through actor-local admission. Their private executors retain distinct state machines; no shared workflow engine or frontend operation state is introduced.
- Preview and submission now cross core commands, host dispatch/projection, Electron allowlists, Zod contracts, and the lifecycle session. Preview sequences survive target changes and are never authorization tokens. A lifecycle contract test verifies request/result delivery and listener teardown.
- Pack display now groups real containers by native index, then foci, then unused capacity. The main pack stays first.
- Added an imperative mounted pointer owner with session-scoped capabilities, fresh release preview, stale-response rejection, equipment-displacement highlighting, cancellation, and click suppression. Cursor positions do not enter Svelte state. This is the first integration, not finished interaction validation: scrolling, complete drag cases, lifecycle corner cases, and visual/theming cleanup remain.
- Added appraisal refinement for legacy two-handers: a known WeaponProfile TwoHandedCombat skill blocks offhand coexistence and prevents targeting the weapon itself to offhand, even when its ValidLocations says MeleeWeapon. Five world equipment tests pass.
- Validation to this point: 14 focused core inventory-related tests passed; 31 focused browser inventory/state/lifecycle tests passed; TypeScript/Svelte checks and ESLint passed. Core/CLI/host all-target Clippy passed before the last appraisal refinement. The existing full client-HUD browser probe passed with the pointer owner mounted. An earlier run was invalidated by a source hot reload mid-probe; the steady rerun passed. Dedicated real CDP drag cases have been added and are now being exercised.

Remaining work is substantial: tighten equipment split/combat completion and mutation coordination; validate complete pack-swap execution; exercise and refine all real drag/drop cases (including scrolling and lifecycle cancellation); run focused live ACE diagnostics; complete architectural cleanup, documentation, and final validation. No unresolved user decision currently blocks implementation.

The dedicated CDP drag probe now passes native submission, stale hover-response rejection after release, merge-only targeting under sorted views, rejection without submission, Escape cancellation with a late preview, and click suppression. The complete client-HUD harness also passes in that same run (`/tmp/holtburger-inventory-drag-probe.log`, screenshot prefix `/tmp/holtburger-inventory-drag.png`). Svelte/TypeScript checks, ESLint, targeted Prettier checks, and world/core/CLI/host all-target Clippy with denied warnings pass at this checkpoint. Equipment, header, pack-swap, scrolling, lifecycle, and completion-state drag cases remain to expand.


### Frontend operation ownership — user steering

The inventory panel submits and forgets the operation, then renders authoritative inventory/equipment facts from the host. It does not need an operation-progress subscription, retained progress snapshot, or local operation lifecycle. Core alone sequences requests and tracks confirmations. Partial failures and uncertain timeouts use the existing action-feedback path. Drag eligibility previews remain transient gesture state and are separate from execution progress. The extra progress contract was removed across core, host, browser schemas, and panel consumers.

Split-to-wield confirmation now requires both the newly equipped entity and the expected source remainder. Before each subsequent request, an externally changed source quantity invalidates preparation. Seven equipment-runtime tests pass, including out-of-order split consequences and preservation of a successful unequip after the next request is rejected. The core/CLI/host library suites passed after removing the frontend progress contract. Live-probe credentials `HOLTBURGER_PROBE_ACCOUNT` and `HOLTBURGER_PROBE_PASSWORD` are currently unset; no credentials were printed and no interactive TUI was launched.


### Acceptance ownership — user steering

The user will perform visual and interactive acceptance. Remaining delivery work is core correctness, automated checks, and cleanup; do not block completion on an exhaustive manual/visual browser acceptance pass. Existing automated drag checks remain useful regressions. The handoff should list the interaction-table scenarios, scrolling/cancellation behavior, and server-rejection/partial-change cases for the user's acceptance pass.

Automated completion checks now include the expanded CDP cases for sorted header append, equipment submission, multi-row displacement highlighting, equipment-to-header unequip, and no optimistic equipment changes. The cancellation cleanup also passed the complete browser harness. Full frontend tests: 2,278 passed across 285 files; lint (ESLint, Knip, host all-target Clippy) and production build passed. Vite reports its standard large-chunk advisory. Full world library suite: 778 passed. Core/CLI/host library suites previously passed 429/350/295 tests, with the subsequent split-confirmation case also passing in the focused equipment suite. Durable inventory documentation and core/app architecture guidance now describe the actual final ownership and protocol semantics. Final quality review and checklist reconciliation remain in progress.


## Final audit and handoff

The implementation covers every interaction in the agreed table. Reviewed seams:
DOM target identity → browser intent/schema → lifecycle transport → host command →
shared evaluator → native/equipment executor → accepted world relationships → entity
projection → inventory display. Preview and submission reuse the evaluator; an
admitted equipment plan now passes directly into its executor. The merge-only
intent preserves the frontend's sorting restriction through fresh server-state
admission. The panel retains no execution progress after submission.

Interruption review covered rejection correlation by outstanding item, per-step
timeout, manual combat changes, lifecycle retirement, and local mutation admission.
No rollback is promised. Known public equipment prediction cannot guarantee ACE's
private classification or server-only wield requirements; final server rejection is
an accepted boundary. Both clients share equipment planning/execution. No duplicate
TUI executor, obsolete conflict loop, progress snapshot contract, or speculative
loadout API remains.

The new code adds pure game-rule planners, two focused core executors, typed host
preview/submission, and an imperative drag owner. A substantial portion of the new
Rust code is behavioral tests. This cost replaces the TUI executor and unchecked
core conflict loop while supporting the five requested operation families. Separate
private equipment/native executor states are coordinated by one actor's admission;
introducing a general workflow framework would not simplify this single-item scope.

Final automated evidence:

- World library: 778 passing tests.
- Core library: 434 passing tests, including complete pack exchange, duplicate first
  confirmation, external target movement, reservations, split consequences, partial
  failure, concurrent admission, manual combat cancellation, and disconnect/late update.
- CLI and host libraries: 350 and 295 passing tests.
- Frontend: 2,278 passing tests across 285 files; `npm run check`, `npm run lint`,
  and `npm run build` passed. Build retains Vite's large-chunk advisory.
- World/core/CLI/host all-target Clippy passed with warnings denied; Rust formatting
  and diff whitespace checks passed. Changed frontend files pass Prettier.
- Real CDP pointer regressions passed native drops, stale preview rejection, sorted
  merge-only targeting, rejected drops, Escape cancellation, click suppression,
  sorted header append, equipment targeting, multi-row displacement highlighting,
  equipped-item unequip, and authoritative display without optimistic mutation.
- Live ACE: not run; required probe credentials are unset. This is a stated validation
  limitation, not evidence that the live interaction scenarios passed.
- No commits/staging, retail-decompile edits, or interactive TUI runs were performed.
  Existing dirty ACE/ACViewer submodule state was left alone.

User acceptance scenarios:

1. Reorder forward/backward under Native sorting; confirm other sorts reject
   positional cell drops but allow merges and header append.
2. Merge partial/full stacks, including equipped quantities and overflow remainder.
3. Equip multi-slot apparel and hand/ammo combinations, with full and partially full
   storage; observe any server-specific rejection.
4. Unequip to a cell and header; swap real packs across foci/native gaps.
5. Check visual feedback, scrolling while dragging, panel closure, and character/
   world transitions. Try the TUI's equipment replacement as well.

Visual and interactive acceptance are explicitly user-owned. The code and automated
validation work are complete; the above live/visual checks are handed off without
claiming they were performed.


User feedback refinement: removed the inventory-specific status/error bar. Hover previews retain target/displacement highlights; rejected drops and request failures use the existing toast center through an app-owned callback. Core action feedback already uses that toast path.


## Accumulated-diff code quality review

Review baseline: HEAD plus all tracked and untracked feature files, including the
TUI executor deletion and subsequent split/selection/drag UX changes. ACE and
ACViewer have pre-existing untracked submodule contents; they are outside the
commit. Earlier phase notes record historical decisions; this interaction table
and `docs/inventory.md` describe the current behavior.

### Contract and lifecycle coverage

| Boundary | Reviewed producer and immediate consumers | Assessment |
| --- | --- | --- |
| World equipment facts | Public properties/appraisal → `equipment.rs` → equipment planner | Apparel priorities, allowed locations, and hand/ammo conflicts retain distinct meanings. Private server requirements remain an accepted rejection source. |
| Storage and merge facts | World containment/quantities → inventory planner and shared allocator → equipment/inventory executors | Native ordering and slot-domain capacity are preserved. Move allocation must account for source removal; split/unequip allocation cannot credit future space. These are intentionally different calculations. |
| Execution | Core command admission → plan → operation → wire action → accepted world confirmation | TUI equip callers now use the same owner. Mutation gates, lifecycle reset, timeout, partial work, and manual combat cancellation were traced. |
| Host and frontend | Core preview → host projection/stdio protocol → Electron transport → lifecycle schema → drag/split owners | Request sequences survive all adapters; preview is not an execution token. Submission and terminal action feedback use existing host/session paths. |
| UI and resources | Mounted inventory panel → drag/split owners → item DOM, icon leases, toast callback, keyboard policy | Drag visuals remain imperative. Dialog state is local; host state alone updates inventory. Disposal, late results, modal focus, and new gestures were reviewed. |
| Shell input | Electron window input callback and removed context menu | Ctrl+Shift+I is independent of DOM focus and was exercised in Electron. |

### Findings addressed before commit

- Fixed drag origin is now retained in the gesture instead of repeatedly inferred
  from a DOM ancestor. Re-rendering or detachment must not change sorted-drop policy.
- Late submission failures report through the toast callback without cancelling a
  newer gesture. A browser regression exercises the actual delayed session promise.
- Split preflight and editing use one discriminated interaction state. Source focus
  belongs to an open dialog; rejected/stale preflight does not retain an independent
  focus lifecycle. Unexpected response variants are reported, and a current no-op
  is handled explicitly.
- Split confirmation excludes the original source identity even when half-splitting
  makes the expected source and new-stack quantities equal. A regression moves the
  original source into the proposed destination without creating a new identity.
- The amount dialog participates in the existing keyboard scope. Tab can reach the
  slider and action buttons even though app input policy disables native Tab traversal.
- README, shared architecture guidance, and current interaction documentation were
  reconciled with sorted unequip append, stack splitting, and full-stack movement.

### Accepted costs and limits

Separate equipment and native-inventory executors remain justified: only equipment
owns peace/wield/restoration and multi-item conflict removal; pack swapping has a
bounded second movement. Their shared allocator removes duplicate capacity policy
without introducing a generic transaction framework. Frontend merge hints ask core
for the active source's candidates on view changes; this avoids duplicating rules
and does not publish or retain an all-pairs matrix.

The added production code implements the now-demonstrated protocols, owning
lifetimes, and UI; the old 484-line TUI weapon-swap mechanism and unchecked core
unequip path are removed. Most repeated declarations at Rust/TypeScript seams are
independently validated serialization boundaries, not alternate business policy.
Harness hooks remain under harness/scripts rather than production contracts.

No live ACE session or visual acceptance is claimed. The unchanged transport,
renderer, and complete server wield-requirements implementation were not broadly
re-audited; review followed their immediate feature seams and reference routines.

### Final automated validation

The affected Rust library suites passed (world 778, core 439, CLI 350, host 295),
as did strict Clippy across their targets and workspace Rust formatting. Frontend
validation passed: 2,278 TypeScript tests, Svelte/TypeScript/Electron type checks,
ESLint, unused-code checks, changed-source formatting, and the production build.
The client HUD browser harness passed, including split-dialog Tab traversal and
a delayed submission failure while a newer drag is active. The build still reports
its large-chunk advisory; bundle restructuring is outside this inventory review.
