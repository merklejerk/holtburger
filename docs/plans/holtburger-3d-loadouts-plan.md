# H3D equipment loadouts

Status: implemented and verified, including the optional-name, compact-cell, empty-slot, scrolling, emoji, and theme revisions. Final quality review is complete. The approved policy warns and rejects stance-sensitive activation while an earlier stance request is unresolved; established combat hand swaps confirm peace once, submit equipment optimistically, and request equipment-appropriate combat restoration.

## Goal and boundaries

Let a player capture a sparse equipment snapshot into a character-scoped action cell and activate it to submit an optimistic equipment swap.

In scope: the inventory button, a non-modal builder, immutable action-cell content, character persistence, coordinated equipment-set planning and submission, friendly failure toasts, and a focused investigation of server swap behavior.

Out of scope: a loadout library, editing saved loadouts, item substitution, ammunition quantities, automatic retries, rollback, per-item receipt-gated progression, completion/progress UI, activation queues, and a general workflow or drag framework.

The user explicitly chose submission without waiting for equipment receipts and subsequently approved one confirmed peace prerequisite for hand-affecting swaps begun in combat. Server updates still establish actual equipment and report refusals; neither submission nor a successful host invocation means every item was equipped.

## Ground truth

Paths below are repository-relative. Recheck references during implementation; code and ACE are authoritative when documentation differs.

| Source                                                                                                                                                                | Existing behavior and implication                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/holtburger-3d/src/client/ClientInventoryPanel.svelte`                                                                                                           | Save loadout is an unwired button labeled as a stub.                                                                                                                                                                |
| `apps/holtburger-3d/src/client/client-inventory-equipment.ts`                                                                                                         | Equipment rows use confirmed placement. Main hand is a combined display mask; multi-slot apparel shares one item identity across rows. Capture from these rows, not allowed locations.                              |
| `apps/holtburger-3d/src/client/ClientHudWindow.svelte` and app `AGENTS.md`                                                                                            | Retained non-modal HUD shell is the established window owner. Visibility does not need to own a draft or submission lifetime.                                                                                       |
| `apps/holtburger-3d/src/client/ClientActionBars.svelte`, `client-action-bar-state.ts`, `client-action-bar-reconciliation.ts`                                          | Cells currently contain item actions. Activation, reconciliation, and cloning must discriminate loadout content before reading item-only fields.                                                                    |
| `apps/holtburger-3d/src/client/client-item-drag.ts`                                                                                                                   | Gesture sources and stale-binding checks assume a single item GUID. Introduce an honest binding-content source rather than a fake entity.                                                                           |
| `apps/holtburger-3d/src/client/client-settings-contract.ts`, `client-settings-sections.ts`, `client-character-settings-owner.ts`; `electron/client-settings-store.ts` | Action bars already belong to character profiles. Use the existing save owner and codecs; preserve existing item cells.                                                                                             |
| `crates/holtburger-core/src/client/equipment_plan.rs`                                                                                                                 | Pure single-item planning already resolves destinations, identifies conflicts, and allocates storage. Independent calls against one unchanged world snapshot cannot coordinate a whole set's reservations.          |
| `crates/holtburger-core/src/client/inventory_storage.rs`                                                                                                              | Allocation uses confirmed capacity and native append positions. Reuse these rules with shared reservations across the submitted set.                                                                                |
| `crates/holtburger-core/src/client/equipment_runtime.rs`                                                                                                              | Existing single-item execution confirms dependent steps and sometimes releases ownership at final send. Do not change its completion policy solely for this feature.                                                |
| `crates/holtburger-world/src/equipment.rs`                                                                                                                            | Apparel targets resolve to full valid coverage; jewelry requires a side; eligible melee weapons can target offhand. Reuse these semantics.                                                                          |
| `crates/holtburger-core/src/client/messages.rs`; `apps/holtburger-3d/host/src/client_projection.rs`                                                                   | Inventory refusals identify a wire item GUID; reasonless refusals are currently filtered from generic feedback. Loadout warnings need attribution even when the server supplies no reason.                          |
| `ACE/Source/ACE.Server/Network/Managers/InboundMessageManager.cs:122` and `Network/GameAction/Actions/GameActionGetAndWieldItem.cs`                                   | Game actions reach server handlers through the world update queue; no explicit equipment throttle is present in these inspected dispatch paths. This does not establish end-to-end throughput.                      |
| `ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs:1524`, `:1651`, `:1812`                                                                                       | Owned-item wield executes directly, the animation busy check is commented out, requirements can reject an item, apparel uses full coverage, and already-equipped items can change slots.                            |
| Same file `:1140`, `:3696`; `Player_Combat.cs:737`                                                                                                                    | Hand-item removals can use deferred stance callbacks. Combat transitions can be delayed by `NextUseTime`; duplicate remove packets also have special handling. Ordered sends alone do not prove ordered completion. |

No live swap timings were collected during scoping. Investigation must distinguish a server throttle from stance delays, transport latency, and client command policy. Use retail `acclient-eor-source/acclient.c` to prove any retail behavior claim; do not modify the decompile or add compatibility markers for an invented divergence.

## Ownership, contracts, and lifecycle

### North stars

- The app knows saved loadouts; core knows equipment requests. No saved-loadout type, registry, name, or action-cell identity enters a shared crate.
- Confirmed world state remains authoritative. Planning assumptions never update the entity mirror, equipment HUD, or real `WorldState`.
- Keep capture and planning stateless. Temporary reservations and feedback attribution are not executable background operations.
- Sparse means no request for an excluded slot, not protection from equipment conflicts.
- Reuse existing equipment semantics and UI owners. Keep dispatcher/composition changes to routing and callbacks.
- Add no field without a named consumer. No success stream, generic job IDs, progress counters, or speculative extension points.

### App layer

Create `src/client/client-loadout.ts` for the immutable snapshot contract, schema, and pure capture/exclusion functions. Create `ClientLoadoutBuilder.svelte` for the draft controls and draggable result.

Extend action content with a discriminated loadout variant:

```ts
type LoadoutBinding =
  | {
      readonly slot: EquipmentSlotMask;
      readonly item: number;
      readonly name: string;
    }
  | {
      readonly slot: EquipmentSlotMask;
      readonly item: null;
      readonly name: null;
    };

type LoadoutActionContent = {
  readonly kind: "loadout";
  readonly name: string; // Optional user label; blank displays Loadout.
  readonly icon: string; // One of the predefined emoji choices.
  readonly bindings: readonly LoadoutBinding[];
};
```

`EquipmentSlotMask` denotes the existing app equipment-row masks, including the combined main-hand display target. It is not a new protocol enum. Validate unique row targets, valid GUIDs, nonblank occupied-item names, consistent null item/name pairs, a valid emoji, and at least one binding. Multiple rows may reference the same apparel GUID; preserve them for presentation and collapse equivalent resolved requests in core.

Consumers: the builder produces the snapshot; action content and the character-settings codec retain it; the cell/tooltip presents it; activation strips saved names and submits equipment bindings. Item-only reconciliation never replaces or removes loadout content.

### Shared execution layer

Create `crates/holtburger-core/src/client/equipment_set.rs`, consumed by the core command dispatcher. Its input is a bounded sequence of `{ item: Option<Guid>, target: EquipMask }`; its work is coordinated planning and ordered optimistic submission. Reuse existing item ownership, location resolution, conflict semantics, storage rules, and action serialization.

Expose an `ApplyEquipmentSet` client command and an `apply_client_equipment_set` host command through the existing typed session/host boundary. Host adapters validate/project and forward; they do not plan the swap. Local per-binding failures identify the requested GUID and target with a typed reason. Host invocation completion means submission finished, not server completion.

Keep the app slot label and saved item name out of core. Extend the existing feedback boundary with optional structured equipment attribution consumed by the app toast path; do not format app-specific slot names in Rust.

### Three independent lifetimes

```text
Inventory button -> builder draft -> immutable character action cell
Action-cell activation -> typed host command -> core equipment-set submission
Server events -> ordinary world updates and attributed warning feedback
```

| Lifetime                 | Owner                          | End                                                                                                                                                                                             |
| ------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unplaced draft           | Builder/app window feature     | Close, successful placement, character change, or world exit. A fresh open captures fresh equipment.                                                                                            |
| Saved snapshot           | Character action-bar cell      | Cell replacement/removal, bar removal, or profile deletion. No separate persisted record exists.                                                                                                |
| Submission               | Core command handling          | Hand-affecting swaps may await confirmed peace once, with a bounded deadline; planning and ordered equipment sends then finish without per-item waits. Transport/session failure stops sending. |
| Recent error attribution | Session/core feedback boundary | Matching authoritative success/refusal, superseding submission, unrelated command for the same item, or world/session exit. It cannot send commands.                                            |

Moving or deleting a cell after activation does not cancel the submitted commands. Retain immutable display context for the latest submission so a toast does not depend on the cell still existing. Do not retain every past activation.

## Behavior and implementation phases

### Phase 1: prove optimistic swap mechanics

- [x] Add a focused debug-harness probe using a disposable test character. Exercise owned inventory only; do not run the TUI.
- [x] Capture confirmations/refusals, final equipment, and timings for available armor, hand, and outfit swaps. Record unavailable jewelry/ammo scenarios explicitly and verify them with synthetic fixtures.
- [x] Compare peace and combat cases, including a stance transition already pending. Inspect server callback execution where necessary to explain results.
- [x] Exercise full inventory synthetically, and invalid bindings between valid items, duplicate activation, and remove-before-wield sequences with the live development inventory. Do not deliberately double-send removal packets.
- [x] Record server revision/configuration and test conditions here. Persistent tests must use synthetic fixtures, not local DATs or account inventory.

Acceptance: an evidenced command recipe for submission without receipt waits, and an explanation of any timing constraint. No arbitrary sleep, receipt-driven queue, or animation timer is introduced to make the probe pass.

Steering gate: if reliable combat restoration or hand swapping requires receipt waits, record the exact limitation and revisit that behavior with the user. Do not silently reverse the agreed optimism policy. Automatic peace/restoration is conditional on this evidence; do not build a deferred restoration lifecycle as a workaround.

#### Investigation: combat-sequencing gap (2026-10-12)

Reference revision: ACE `c455c0097f62c15e2959b3f90855338fbe191be9`. The submodule contains the pre-existing untracked `Source/ACE.Server.Tests/SyntheticProtocolTests.cs`; it was inspected but not modified.

The source establishes a counterexample to assuming ordered sends imply ordered inventory changes:

1. The player has caster A equipped in magic combat, with `NextUseTime` still in the future from a stance transition.
2. `HandleActionChangeCombatMode(NonCombat)` queues its inner work when `NextUseTime` has not elapsed (`Player_Combat.cs:737-773`). It does not immediately establish peace.
3. `HandleActionPutItemInContainer(A, ...)` still sees combat. `RequiresStanceSwap` returns true for `Held` (`Player_Inventory.cs:461-480`), so the actual removal is a callback to a stance change (`:1162-1177`). The callback is itself delayed by animation time (`Player_Combat.cs:895-901`).
4. A following `HandleActionGetAndWieldItem(B, Held)` for an owned, currently unequipped caster executes immediately (`Player_Inventory.cs:1645-1647`). Its collision check sees A still occupying main hand and rejects B (`:1666-1671`, `:1996-2001`).
5. The already queued callback can subsequently remove A. There is no retry of B, so the expected swap can leave the hand empty. Sending additional stance requests does not establish a synchronous prerequisite.

This is a source-proven ordering hazard, not a live reproduction or a measurement of its frequency. It does not prove every swap fails or that the server rate-limits equipment. Stable peace avoids the specific `RequiresStanceSwap` branch; the full peace-mode recipe and all other scenarios still need empirical verification.

At scoping time no live credentials were configured. The user subsequently supplied the development account through `apps/holtburger-3d/.dev.env`; the live results below supersede that prerequisite gap. Credentials were passed through child-process environment variables and redacted from diagnostic output.

Resolved by the user: for a swap whose admitted commands affect either hand (including conflicting removals), request peace only when currently in combat and await confirmed peace once. Replan against confirmed state after peace; submit the equipment commands without per-item receipt waits. Request the combat mode appropriate to intended resulting equipment afterward, without waiting for restoration. Armor/jewelry-only swaps do not enter peace. A swap begun in peace remains in peace. Awaiting peace uses existing equipment timeout policy and inventory admission protection; timeout sends no equipment commands. Live verification additionally needs an explicit test server/character with probe credentials configured outside command arguments/output, but this no longer prevents implementing the approved policy with synthetic verification.

### Phase 2: coordinated equipment-set primitive

- [x] Resolve each requested target once using existing world semantics. Skip already-satisfied bindings, deduplicate equivalent apparel requests, and report missing/not-owned/invalid bindings while retaining the rest.
- [x] Reject conflicting desired destinations locally rather than let two bindings fight. In strip order, keep the first admissible request and report the later conflicting one. Captured current equipment should naturally be compatible.
- [x] Identify current equipment that must move to inventory, deduplicate removals, and associate each removal with the incoming requests it enables. An already-equipped desired item may itself be displaced before being wielded at its saved destination.
- [x] Reuse the allocator with temporary reservations shared by admitted requests. Do not independently allocate every binding against unchanged storage. A rejected binding must not consume reservations or cause otherwise-unneeded removal.
- [x] Reserve confirmed free capacity; do not depend on a future successful wield freeing storage. This deliberately conservative first version can refuse a swap that a more elaborate interleaving could fit. Document the limitation in feedback and cover it with tests.
- [x] Emit each admitted removal once, followed by desired wield requests in equipment-strip order. Do not update confirmed world state while constructing or sending the plan.
- [x] Extract only demonstrated shared resolution/allocation helpers from the single-item planner. Leave the existing single-item runtime and its receipt-dependent behavior intact. No cloned full world, parallel equipment rules, or general simulation engine.
- [x] Apply existing in-world/busy admission rules before sending. Reject entry while a confirmed single-item equipment operation, pack exchange, or incompatible busy interaction is active. Once accepted, finish sending without holding a new receipt-based busy lock.
- [x] Use the stance recipe established in Phase 1. Compute any intended post-swap stance from admitted equipment facts through shared semantics, never from a stale pre-swap equipment HUD. Transport failure stops remaining sends and propagates through the existing error path.

Acceptance: synthetic tests prove coherent storage reservation, one removal per item, correct explicit slot targets, no-op suppression, and continued submission past local per-binding errors. The only pending execution state/deadline is the confirmed-peace prerequisite; no per-item receipt-gated advance or completion lifecycle exists.

### Phase 3: typed bridge and failure feedback

- [x] Wire core command, host command decoding/dispatch, and session method with typed equipment bindings. Preserve normal wire actions and session sequencing.
- [x] Emit local planning failures with requested GUID and target; the app resolves captured names and slot labels into warning toasts.
- [x] Retain a bounded latest-submission attribution table for sent item actions. Associate a refusal of a displaced item with the binding(s) whose equip depended on that removal; use neutral wording that does not claim an equip succeeded or failed before a relevant response.
- [x] Report reasonless inventory refusals as an equipment warning when attributed: `Could not equip <saved name> to <slot>: the server rejected the request`. Use the supplied reason when available.
- [x] Integrate attribution into existing action feedback so one refusal does not produce duplicate generic and loadout toasts. Keep unrelated chat/server diagnostics on their existing paths.
- [x] Clear attribution on the lifecycle events listed above. Receipts may retire attribution, but never start the next command, trigger retries, or complete a job.

Acceptance: missing items and both reasoned/reasonless server refusals produce named slot warnings; subsequent submitted bindings still run. Tests cover displaced-item attribution and lifecycle cleanup. The server supplies item identity, not invocation identity, so late failures across repeated activations are best-effort attribution to the latest applicable submission, never a guarantee of exact correlation.

### Phase 4: immutable character action-cell content

- [x] Extend action content and settings schemas together. Preserve current item action shapes and existing character profiles; no user-level loadout section or loadout registry.
- [x] Keep snapshots embedded in cells. Removing/replacing a cell or deleting its bar drops the snapshot through ordinary settings persistence. Bar cloning copies independent immutable content.
- [x] Extend action-cell presentation with the existing loadout icon, saved name, and tooltip rows. Missing items retain their saved names and bindings. No automatic item substitution, availability-driven deletion, or active-loadout indicator.
- [x] Dispatch loadout activation through the new session method before item-specific activation/reconciliation logic. Alternate-side modifiers do not alter saved targets.
- [x] Generalize the existing gesture source just enough to carry captured binding content. Loadout sources and cells target action cells only; never run inventory previews or world item actions for them. Preserve established cell transfer/removal semantics and stale-source checks using content identity rather than a fabricated GUID.

Acceptance: save/reload, character isolation, movement, bar cloning, replacement, removal, and missing inventory all preserve the defined snapshot ownership. Existing item bindings continue to parse, reconcile, drag, and activate.

### Phase 5: builder and HUD integration

- [x] Wire the inventory button to the existing HUD window owner. Add the retained non-modal builder using shared window chrome, inputs, buttons, checkbox conventions, and keyboard ownership.
- [x] Opening captures confirmed equipment once. Show every slot in a compact item-cell grid; occupied rows start included, empty rows start unchecked and can be included to request unequip. Equipment changes while open do not rewrite the snapshot.
- [x] Disable opening/capture when equipment placement or captured names are incomplete, with an honest availability message. Do not invent names or claim an unhydrated slot is empty.
- [x] Provide an optional loadout-name editor, predefined emoji choices, and row inclusion controls. Require at least one included row before exposing the draggable result.
- [x] Explain full apparel coverage and ordinary conflict displacement beside the row controls. Unchecked rows mean no explicit request, not partial armor coverage or protection.
- [x] A successful drop into any action cell persists the content and closes/discards the draft. Cancelled or invalid drags retain it. Closing discards an unplaced draft; no unsaved-loadout storage or edit context menu.
- [x] Keep `ClientApp`, inventory, and action-bar composition changes limited to feature wiring. Domain functions and draft behavior stay in the dedicated feature module/component.

Acceptance: the browser harness verifies open/capture, naming, exclusions, empty selection, cancelled drag, successful drop, action-cell activation, and world/character exit cleanup. The user owns visual acceptance; do not perform an unsolicited visual review.

### Phase 6: cleanup and verification

- [x] Remove the stub title and any touched item-only assumptions. Consolidate duplicate schemas and helper logic rather than leaving aliases or parallel implementations.
- [x] Check every new type/field has a consumer and a comment. Remove abandoned counters, receipt controllers, speculative interfaces, and unused assets/imports.
- [x] Re-run affected synthetic Rust and TypeScript tests. Run app `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and formatting checks; run clippy for core and host with `-D warnings`.
- [x] Run browser-harness interaction verification and the Phase 1 live probe against the final implementation. Record results and concrete missing prerequisites here if a live environment is unavailable.
- [x] No staging or commits unless separately requested. Preserve unrelated workspace/submodule changes.

## Test matrix and risks

| Scenario                                                      | Expected result                                                                                      |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| All included items already occupy saved targets               | No equipment commands.                                                                               |
| Sparse snapshot                                               | Only included requests are submitted; legitimate conflicts may displace excluded equipment.          |
| Missing item or unmet server requirement                      | Named slot warning; other bindings continue.                                                         |
| One armor item appears in several included rows               | One resolved wield request; full coverage remains intact.                                            |
| Left/right rings, wrists, or eligible hand items change sides | Saved explicit destinations are used; removals are deduplicated.                                     |
| Several replacements need inventory space                     | Reservations never overlap or exceed confirmed capacity; rejected bindings do not leak reservations. |
| Invalid/conflicting desired set reaches core                  | Per-binding local errors; no contradictory admitted command sequence.                                |
| Server refuses a removal                                      | Attribution names affected binding(s); commands already submitted are not rolled back or retried.    |
| No equipment receipts arrive                                  | Submission still returns; no timeout/completion lifecycle is created.                                |
| Loadout cell disappears after activation                      | Commands remain submitted; retained latest feedback context still supplies saved names.              |
| Rapid repeated activation or unrelated inventory action       | No queue or busy lock added; late errors have documented limited correlation.                        |
| Reload and switch characters                                  | Each character restores only its own action-bar snapshots.                                           |
| Transport failure or world exit                               | Stop unsent work through existing lifecycle/error handling; discard transient context.               |

Primary risk: optimistic submission can partially apply and can cascade failures when an earlier removal is rejected or delayed. The user accepts best-effort swaps; preserve honest feedback and actual world updates rather than adding a transaction.

Architectural friction: coordinated planning needs shared reservations, while current planning is single-item and world-backed. Narrow helper extraction is deserved; a speculative inventory engine is not. Conservative free-space planning is the v1 concession.

## Definition of done and open evidence

- [x] The agreed capture, exclusion, placement, activation, missing-name, and deletion behaviors work end to end.
- [x] Saved loadouts are app-local immutable character data embedded in action cells. Core exposes only reusable equipment-set behavior.
- [x] No loadout library, per-item receipt waits, activation queue, retries, rollback, speculative world mutation, or background completion manager has been added.
- [x] Automated checks pass, browser interactions are verified, and live swap evidence or exact unavailable prerequisites are recorded.
- [x] User visual acceptance remains clearly separated from automated verification.

Product decisions are settled, including the confirmed-peace prerequisite and pending-stance warning/rejection. Live probes verify the available outfit and hand-swap recipes; exact jewelry, ammo, and capacity limits are recorded below and covered synthetically. These measurements do not establish a universal maximum equipment rate.

## Live verification and steering gate (2026-10-12)

Environment: local ACE at `127.0.0.1:9000`, source revision `c455c0097f62c15e2959b3f90855338fbe191be9`. The running process was not rebuilt or its configuration changed by this work; its binary revision was not independently verified. The supplied development account has one selectable character, `+Holtfighter` (`0x50000002`). Only owned inventory was used. No TUI or visual acceptance check ran.

The noninteractive `live_equipment_set_probe` supports read-only `roster` and `inspect` discovery, then explicit `swap` targets. Observation windows do not pace production equipment commands. Timings below start at equipment-set submission and describe server-derived updates seen by the client, not an equipment throughput guarantee.

| Experiment                                                                                                                 | Observed result                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Peace outfit burst: Puffy Tunic, Academy Coat, Shoes, Flaming Scimitar                                                     | All four requested items equipped; final placements observed at 0.081, 0.093, 0.099, and 0.124 seconds. Conflicting existing pieces were removed first; stance remained peace. No refusal was observed.                                                                                                                                                               |
| Melee: Acid Kaskara to main hand, an invalid owned coal-to-chest binding, and already-equipped Flaming Scimitar to offhand | One confirmed peace update at 0.596 seconds; hand placements at 0.636 and 0.665 seconds; equipment-appropriate melee restoration at 1.212 seconds. The invalid middle binding emitted its own local warning and did not stop either valid binding.                                                                                                                    |
| Two consecutive activations during that peace prerequisite                                                                 | The overlapping activation was rejected with an inventory-pending warning; no second command burst or removal was queued.                                                                                                                                                                                                                                             |
| Initial melee request sent while confirmed state was peace, immediately followed by restoring the original caster/outfit   | **Counterexample:** planning saw peace and sent the burst immediately. Melee confirmation arrived at 0.049 seconds, caster equip was refused without a server reason at 0.157 seconds, and deferred offhand/main-hand removals arrived at 0.677/1.820 seconds. Armor and clothing restoration continued successfully, but final main hand was empty and stance melee. |

The failing experiment reached the documented Phase 1 steering gate: confirmed peace alone was insufficient while an earlier outgoing combat request was unresolved. At that checkpoint, core did not track outstanding stance requests. The approved fix below closes this admission gap through warning and rejection, independently of per-item receipt pacing. It introduces no arbitrary delay, equipment retry, or deferred equipment completion controller.

Resolved by the user: warn and reject activation while an earlier stance request remains unresolved. Core now tracks one outstanding stance request at the shared send boundary, coalesces repeats for the same mode, and warns rather than sends a different mode until the server confirms the requested mode or reports peace as denial. Hand changes and ammo removals use this admission gate; armor/jewelry-only sets continue. World/session lifecycle reset clears tracking. This adds no activation queue, equipment receipt waits, or retry behavior. A later activation from established combat uses the verified one-peace prerequisite.

Live limits: no jewelry or spare ammunition stack was present, so jewelry and ammo replacement are covered synthetically only. Inventory capacity refusal is also synthetic; the live character had free storage. No generic server throttle was observed in the successful bursts, but these samples do not establish a maximum rate or reliability across other server configurations.

Automated evidence: 659 core unit tests passed; 57 affected TypeScript tests passed; the focused browser loadout probe passed all seven checks (capture, exclusions, cancellation, placement, numeric activation, deletion, and named failure after cell removal) with no browser errors. App type checks, ESLint, Knip, and core/host/harness Clippy with warnings denied passed. The full HUD browser regression passed its inventory/action-bar/loadout stages but failed later in `probeClientTheme` at the startup-failure lifecycle-screen assertion (`client-theme-probe.mjs:220`), following the deliberately malformed user-settings response. That failure has not been diagnosed; the complete HUD suite is not green. Two host equipment-set projection/decoding tests passed. Review traced capture → settings/cell → session numeric adaptation → host → core planning/submission → attributed feedback, plus drag and lifecycle cancellation. At that checkpoint the pending-stance seam was a confirmed blocker; the approved fix and final evidence below supersede it.

Cleanup after live probing: a separate peace-mode request restored all six original equipped GUID/mask pairs and confirmed `NonCombat`. The final caster placement was observed at 0.061 seconds. No probe equipment remains equipped beyond the recorded starting outfit; inventory ordering changed through ordinary remove/equip operations. Credentials were not copied into repository files or emitted in tool output.

### Verification after the approved stance-admission fix

- Pending magic request followed immediately by an owned caster-swap activation: warning at 0.018 seconds, magic confirmation at 0.027 seconds, all six original equipment GUID/mask pairs unchanged. No equipment requests were submitted.
- The same caster swap after confirmed magic: confirmed peace at 0.567 seconds, desired caster placement at 0.618 seconds, restored magic at 1.147 seconds. No equipment refusal was observed.
- Final cleanup restored the original Staff of Aerfalle at 0.036 seconds and confirmed all six original equipment pairs with peace stance.
- Added synthetic coverage for paired ring/wrist exchanges, pending-stance hand rejection and later admission, same-mode coalescing/different-mode refusal, denial/lifecycle reset, and armor-only admission during a pending stance request. The final core suite passed 663 tests; two host equipment-set adapter tests and 90 affected TypeScript tests passed.
- The full HUD harness's startup fixture used obsolete settings load/save shapes; it now implements the current section-based preload contract. Its theme probe also navigated away before the character-sheet probe; fixture-dependent checks now run before the terminal navigation. The final complete HUD rerun passed after those corrections and the focus/layout expectation corrections noted below.

Review concessions: one outstanding stance request avoids a queue without protocol request IDs. A repeated request for that same mode sends nothing; a different mode warns. A requested mode or server peace denial retires tracking, and world/session reset discards it. No synthetic stance deadline releases an unresolved wire request. Recent equipment-error attribution remains best effort for delayed responses across repeated activations, as agreed. Storage planning remains deliberately conservative and does not credit space freed by a future successful equip.

Persistence evidence: the Electron settings-store test writes two different character profiles to a temporary settings file, constructs a fresh store to verify both snapshots, deletes one character's loadout cell, and reloads again to verify deletion and preservation of the other character's snapshot. All 13 store tests passed. The shared action content schema preserves item cells and captures missing-item names as ordinary saved snapshot data.

## Final completion audit

- `npm run harness:browser -- --client-hud --brief` passed the full suite, including inventory/loadouts, keyboard ownership, object inspection, targeting, startup/theme, character sheet, settings, and HUD geometry. Three expected injected asset/host-failure warnings were reported. No screenshot or visual acceptance inspection was performed.
- The Trade Examine fixture now waits for deliberate keyboard focus rather than assuming a programmatic `focus()` call succeeded immediately after pointer selection. The strict layout inventory now includes the existing Party HUD preview. These harness corrections retain the original behavior assertions.
- Final static checks: app Svelte/TypeScript/Electron checks, ESLint, Knip, affected-file Prettier checks, Rust formatting, and core/host Clippy with warnings denied passed. The probe binary also passed Clippy. `git diff --check` passed.
- Test evidence: 663 core tests, two host equipment-set adapter tests, 90 affected frontend tests, and all 13 Electron settings-store tests passed. The focused loadout browser probe passed all seven scenarios; the final full HUD suite also passed.
- Ownership audit: immutable named snapshots live only in character action-bar cells; dedicated app capture/schema/builder code owns loadout policy; session/host adapters strip names into numeric equipment requests; the dedicated core equipment-set module owns coordinated planning, one peace prerequisite, optimistic submission, and bounded latest error attribution. Core has no saved-loadout registry or action-cell metadata.
- Lifecycle audit: closing/cancelling retains or discards the draft as specified; successful placement closes it; cell/bar deletion removes persisted snapshots structurally; missing inventory does not reconcile away saved bindings; world/session changes retire draft/prerequisite/feedback state. Recent names survive cell removal for warnings.
- Submission audit: sparse/no-op bindings produce no extra requests, duplicate apparel requests collapse, explicit side swaps work, storage reservations are shared and conservative, invalid bindings continue best effort, pending stance rejects without equipment mutation, and server events alone update actual equipment. No per-item receipt progression, retry, rollback, activation queue, or completion job exists.
- Live cleanup confirmed the original six equipment bindings and peace stance restored. No account credentials were printed or stored in repository artifacts. No staging or commits occurred; the unrelated pre-existing ACE test remains untouched.

Accepted limits remain conservative inventory capacity, partial application after server refusals, best-effort attribution for delayed responses across repeated activations, and no live jewelry/ammo replacement samples on this character. User visual acceptance remains separate from the automated completion evidence.

## UX revision requested after review

- Names are optional; blank names display `Loadout`. Saved occupied-item names remain required for missing-inventory feedback.
- The builder uses shared item-cell presentation in a compact responsive grid, with captured icon leases rather than following later equipment changes. Its body fills the HUD content allocation and owns a bounded scroll region; the draggable result remains accessible in a fixed footer.
- A curated emoji picker chooses the persisted action icon. The picker, drag ghost, result, and saved action cell use the same emoji. Existing saved snapshots without an icon decode with the initial star choice.
- Checked empty rows save `{ slot, item: null, name: null }`; unchecked rows are omitted. The app schema expresses occupied and empty rows as a union, preventing inconsistent identity/name pairs.
- Core and host bindings carry an optional GUID: `Some` requests equip, `None` requests an empty location. Empty requests identify current equipped occupants, reserve confirmed free storage, and submit whole-item removals with per-slot attribution. An already-empty target sends nothing. Contradictory empty/equip requests reject the later binding; other requests continue.
- Removing one occupied part of multi-slot armor removes the whole item, as the protocol requires. The same hand/ammo stance admission and one-peace prerequisite apply to explicit clears. No new receipt queue, retry, or loadout registry is introduced.

Revision evidence: all 667 core tests, both host adapter tests, and 96 affected frontend/settings-store tests passed. The expanded focused browser probe passed all 11 scenarios, including actual wheel scrolling, optional naming, selected-emoji rendering, explicit empty-slot activation, and clear-slot warning feedback; no browser errors were reported. App type checks, ESLint, Knip, affected-file formatting, and core/host/probe Clippy with warnings denied passed. The last full HUD regression predates this UX revision; the revised browser checks cover the affected builder/action-cell flow directly.

Live empty-main-hand verification: starting from confirmed magic, peace arrived at 0.581 seconds; the caster was confirmed in inventory at 0.624 seconds; equipment-appropriate melee resumed at 1.164 seconds with an empty main hand. A separate peace activation restored the original caster at 0.027 seconds and confirmed all six original equipment pairs and peace stance. The existing conservative capacity, whole-apparel removal, and latest-feedback correlation limits still apply.

User visual acceptance remains separate from automated DOM/interaction checks.

## Identity-section and icon-picker refinement

The user requested that name/icon controls be separated from the mapping grid and explicitly chose to leave the mapping layout unchanged in this pass. This pass introduced a dedicated name-and-icon fieldset, subsequently consolidated into the fixed footer as described below. A single selected-emoji preview opens the existing app popup menu in a bounded scrolling grid; the shared component still defaults to its existing command-list behavior. The curated palette contains 84 emojis, with selection persisted through the same action-cell schema.

Horizontal overflow was reproduced through DOM measurements: the mapping scroller had a client width of 347 pixels and a scroll width of 352 pixels. The shared HUD button's six-pixel pseudo-element backing escaped the new cells; ordinary inventory cells already contain it with `overflow: hidden`. Matching that cell containment, along with standard item-cell padding, removes the overflow at its source. The scroller's horizontal overflow was not merely hidden.

The focused browser probe passed dropdown selection/dismissal, keyboard-driven popup scrolling, emoji propagation into the saved action cell, optional naming, empty-slot bindings, vertical scrolling, and a no-horizontal-overflow assertion, with no browser errors. Type checks, ESLint, Knip, and affected-file formatting checks passed. User visual acceptance remains separate. Equipment mapping controls and execution policy remain as before this refinement.

Final refinement checks: the expanded loadout browser probe passed all 14 reported scenarios, including the shared popup's ordinary action-bar list navigation, with no browser errors. The separate keyboard-policy browser suite passed. All 19 loadout/settings-store tests passed; app type checks, lint, and formatting checks passed. No staging, commits, live account mutation, or visual acceptance inspection was performed for this UI-only refinement.

## Fixed-footer identity refinement

The name input now lives beside the draggable emoji in the fixed footer. It has no visible label; its placeholder reads `Loadout name (optional)` and its accessible name remains `Loadout name`. The former identity fieldset and duplicate icon preview were removed. Mapping controls remain unchanged.

`ClientLoadoutIconDropdown` owns the combined preview/disclosure button, its transient emoji popup, and registration with the existing action-cell drag owner. The emoji area has a grab cursor when a valid draft can be placed; a separated chevron segment exposes the selector. Clicking opens the existing scrolling popup; dragging uses the existing click suppression and placement lifecycle. The selector remains available when no slots are included, while the drag owner receives no valid draft. Hiding the retained builder dismisses its popup. Draft content and selected icon remain builder-owned; no shared game behavior changed.

Verification: the expanded browser probe passed all 16 reported scenarios with no browser errors, including fixed footer position during mapping scroll, footer controls fitting side by side, popup selection and keyboard dismissal, cancelled drag click suppression, successful placement, and saved emoji propagation. App type checks, ESLint, Knip, and scoped formatting checks passed. No visual acceptance inspection was performed.

## Create-loadout wording, footer, and examination refinement

The inventory button and builder title now read `Create loadout`. The explanatory paragraph beneath the mapping grid was removed. The fixed footer aligns its contents to the right, with the optional name input followed by the emoji/dropdown control at the right edge.

The loadout tooltip owns one heading: `Loadout "NAME"`, or `Loadout` for an unnamed snapshot. Action cells prefix that heading with the cell address and append the equipment bindings and keyboard hint without repeating the name. Occupied builder cells expose their captured GUID to the world view's existing context-menu examination handler; empty cells expose no GUID. Examination uses the same selection and inspection owner as inventory cells, without changing the draft's inclusion state or adding a separate inspection lifecycle.

Verification: all 18 focused browser scenarios passed with no browser errors, including right-click examination of the captured item, no examination for empty cells, unchanged inclusion on examination, right-edge footer placement, persisted naming, and a single named action-cell heading. All six loadout unit tests, app type checks, ESLint, Knip, scoped formatting, and whitespace checks passed. No visual acceptance inspection, staging, or commits were performed.

## Shared item-grid density

The loadout grid previously introduced a separate 48-pixel minimum and `auto-fit`, while inventory contents used the shared 36-pixel minimum and `auto-fill`. This made loadout cells larger and allowed sparse grids to stretch cells across unused columns.

The app-local `ui-item-grid` class now owns responsive collection sizing and spacing. Loadout, inventory/container contents, and trade offers consume it. Its minimum is `--ui-item-cell-min-size`; its spacing is `--ui-item-grid-gap`; columns use the inventory's existing `auto-fill` rule and grow to fill their available width. The redundant trade-specific gap token was removed. Equipment/pack strips and action bars already consume the same item-size token, retaining their fixed arrangements. Feature owners retain slot headings, labels, scrolling, and gestures. Large inspection artwork and vendor list thumbnails are distinct preview presentations rather than responsive item cells.

Verification: all 19 loadout browser scenarios passed with no browser errors, including runtime density checks against the shared minimum and a larger test-owned theme basis. The separate trade browser suite passed. App type checks, ESLint, Knip, scoped formatting, and whitespace checks passed. The scrolling test now creates overflow through a temporary theme size instead of requiring the compact default grid to overflow. Theme overrides are restored afterward. No visual acceptance inspection was performed.

## Random unused draft icons

Opening the builder now samples uniformly from curated emojis absent from all loadout cells on this character's saved action bars. Missing inventory does not free an icon; deleting the referencing action cell does. When the palette is fully used, opening samples from the entire palette rather than blocking creation. User selection remains unrestricted.

The app-local loadout helper owns this selection policy. The world view samples once after a successful equipment capture and carries the chosen icon in the composite opening draft. The retained builder resets its editor from that draft, so later bar changes and slot edits do not reroll the icon. Persisted schemas and existing saved-icon defaults remain unchanged; no icon registry or reservation lifetime was introduced.

Verification: all nine loadout unit tests passed, including random palette endpoints, exclusion across multiple bars, and palette exhaustion. All 20 browser scenarios passed with no browser errors, including opening with a saved star icon and receiving a different default. App type checks, ESLint, Knip, scoped formatting, and whitespace checks passed. No visual acceptance inspection, staging, or commits were performed.

## Mapping spacing refinement

The loadout grid retains the shared item-cell minimum and responsive column rule, with feature-local spacing between its richer slot mappings: twice the shared item-grid gap horizontally and three times vertically. With the default theme this is 10 pixels between columns and 15 pixels between rows. Inventory and trade density remain unchanged.

Verification: all 20 focused browser scenarios passed with no browser errors, including shared cell density, scrolling, and no horizontal overflow. App type checks, scoped formatting, and whitespace checks passed. No visual acceptance inspection was performed.

## Resize-dependent horizontal overflow

A strict resize probe reproduced one-pixel overflow: the mapping scroller's client width was 266 pixels but its scroll width was 267 pixels. The escaping descendants were the inclusion checkboxes. Their native margins made the icon/checkbox headings exceed the shared minimum cell width at a column breakpoint. The earlier browser assertion tolerated one pixel and missed this failure.

The builder removes those checkbox margins and keeps the checkbox from shrinking. The existing icon and checkbox now fit within the shared minimum; the grid and scroll region remain fully measurable, without hiding horizontal overflow. The browser probe checks exact overflow rather than allowing a one-pixel tolerance, drives the actual HUD resize handle through 141 consecutive pixel widths from the measured panel minimum, verifies that each requested resize occurred, and restores the original width afterward. Failure output identifies escaping descendants.

Verification: all 21 browser scenarios passed with no browser errors, including the exact-overflow sweep through all 141 widths. App type checks, ESLint, Knip, scoped formatting, and whitespace checks passed. The fix was verified through DOM measurements and gestures; no visual acceptance inspection was performed.

## Shared checkbox spacing

Checkbox margins are now normalized to zero in the app's shared theme rules, with shrink prevention shared there as well. The loadout-only margin rule and ToggleField's redundant margin reset were removed. Shared `ui-checkbox` labels own flex alignment and a six-pixel checkbox/text gap through `--ui-checkbox-label-gap`; the ToggleField grid consumes the same gap token.

Settings, combat indicators, environment controls, Friends, Party/Social, Allegiance, Housing, the Explorer texture toolbar, and the UI showcase consume the shared checkbox-label layout. Redundant feature-specific label alignment/gap declarations were removed. Housing retains its feature-owned space between whole rows, and loadout headings retain their slot-icon/checkbox arrangement. No keyboard, selection, persistence, or game behavior changed.

Verification: the loadout browser probe passed all 21 scenarios, including the 141-width no-overflow sweep. Separate keyboard, party/modal, and housing browser suites passed. App type checks, ESLint, Knip, scoped formatting, and whitespace checks passed. No visual acceptance inspection was performed.

## Loadout themeability cleanup

Builder and combined icon-control styles now belong to `@layer components`, allowing the app's later `theme` and `overrides` layers to replace feature defaults. Slot labels and the placement hint use the existing `--ui-font-size-caption` token instead of fixed rem font sizes. Geometry defaults remain simple component CSS; no new loadout-specific theme variables were added.

The focused browser probe temporarily injects a real theme-layer stylesheet overriding caption size, label line height, and icon-control width, asserts the computed values, then removes it before running the existing resize and placement checks. The action-cell placement copy also uses the grammatically correct `an action cell`.

Verification: all 22 focused browser scenarios passed with no browser errors, including actual theme overrides and the 141-width no-horizontal-overflow sweep. App type checks, ESLint, Knip, scoped formatting, and whitespace checks passed. No visual acceptance inspection was performed.

## Layered CSS source-order regression

The user's screenshot exposed a footer regression after moving loadout styles into the component layer. The scoped icon-control selector and shared `.ui-theme .ui-shortcut-cell` geometry had equal specificity. When shared CSS loaded later, its full-width/full-height/block rules displaced the compact flex control, collapsing the name field and expanding the footer. The previous harness import order did not exercise this collision.

The icon-control geometry is now an explicit `.ui-shortcut-cell.loadout-icon-dropdown` modifier. Mapping cell geometry similarly uses `.ui-item-cell.loadout-item-cell` so shared HUD padding cannot displace it when imports reorder. Both remain in the component layer; theme and override layers retain precedence. No unlayered rules or important declarations were introduced.

The browser probe clones the actual shared UI stylesheet into the end of the document, verifies compact footer height, flex layout, a usable name field beside the icon, and no horizontal overflow, then removes the clone. Existing theme-override and resize checks remain enabled.

Verification: all 23 focused browser scenarios passed with no browser errors, including the late-shared-stylesheet regression check, theme overrides, and the 141-width resize sweep. App type checks, ESLint, Knip, scoped formatting, and whitespace checks passed. No visual acceptance inspection was performed.

## Compact mapping captions

Equipment-slot presentation metadata now supplies both full names and compact builder captions. Visible captions use `Main`, `Off`, `Ammo`, `Chest`, `Abd.`, `U. Arm`, `L. Arm`, `U. Leg`, `L. Leg`, `Wrist (L/R)`, `Ring (L/R)`, and `Aeth. (B/Y/R)` where appropriate. The aetheria suffixes identify Blue, Yellow, and Red, rather than left/right position. Other short names remain as before.

The builder shows compact captions with full slot names on hover. Item-cell tooltips, checkbox accessibility labels, equipment-icon labels, saved-action tooltips, and feedback keep full names. Equipment masks, capture, and persisted bindings are unchanged; no string parsing or slot-name inference was added.

Verification: all 14 relevant equipment/loadout unit tests and all 23 browser scenarios passed with no browser errors. App type checks, ESLint, Knip, scoped formatting, and whitespace checks passed. No visual acceptance inspection was performed.

## Shared themed drag previews

Cursor clearance previously appeared as repeated `+ 12` pointer arithmetic in item/loadout/housing paths and separate left/top positioning in spell drags. Both owners now position their ghosts through the shared app helper using raw pointer coordinates. Shared CSS adds `--ui-drag-ghost-offset` on both axes through its translate property, defaulting to 12 pixels. CSS resolves rem/calc units and live theme changes directly; pointer movement performs no style measurement or reactive publication.

A shared artwork helper also replaces duplicated ghost cloning and sizing. Inventory item artwork, the builder's emoji-only preview, and spellbook icon containers identify their visual bounds with `data-drag-preview`; unmarked sources use their artwork bounds. Preview sizing follows rendered, theme-controlled artwork rather than surrounding buttons, dropdown arrows, or row labels. Item, loadout, housing, and spell drags retain their gesture, admission, cancellation, and placement owners.

The focused loadout browser probe applies a temporary 1.25rem cursor gap and measures both loadout and inventory previews during real pointer drags. It verifies their displayed artwork dimensions and common pointer clearance, cancels both gestures, and restores the theme property.

Focused verification: all 24 loadout browser scenarios passed with no browser errors, including measured inventory/loadout cursor offsets and artwork-only dimensions under a 1.25rem theme override. The comparison uses a main-inventory cell because the equipment strip's scroll arrow can cover the equipment cell selected by a generic scroll-into-view call. The ordinary action-menu regression check now invokes the menu associated with the captured bar identity, avoiding pointer occlusion from windows retained by earlier full-suite scenarios. The separate housing browser suite passed; app type checks, ESLint, Knip, scoped formatting, and whitespace checks passed. The subsequent full HUD regression passed, including inventory and spell-bar drag flows.

Final drag-preview verification: the full HUD suite passed after the comparison probe targeted a visible inventory cell and the intended action-bar menu. This covers inventory transfers, action-cell gestures, spellbook/spell-bar dragging, keyboard policy, and the 24 focused loadout scenarios in the composed UI. The separate housing suite passed. App type checks, ESLint, Knip, scoped formatting, and whitespace checks passed. No visual acceptance inspection, staging, or commits were performed.

## Final code-quality review

Verdict: ready within the reviewed feature scope after two bounded regression fixes. The baseline was HEAD, including all new files, the accumulated UI refinements, shared primitive changes, tests, and diagnostics. The ACE submodule's unrelated untracked test remains excluded.

Confirmed findings, both fixed before commit:

- P2: `ClientAllegiancePanel.svelte` lost member-heading flex alignment when a grouped label rule was replaced by shared checkbox styling. The surviving selector was duplicated and retained only its gap. Restored display/alignment in the existing member-heading rule and removed the duplicate. Acceptance: the heading retains its original flex alignment while checkbox labels consume shared spacing; the allegiance browser suite exercises relationship-tree alignment and theme density.
- P2: `ClientLifecycleSession.#receiveLifecycle` cleared equipment names before rejecting an older portal generation. An ignored message could therefore change later warning text without changing accepted lifecycle state. Moved retirement after the generation guard. Acceptance: submit a named binding, inject an older portal, and receive a refusal that still names the saved item. The session regression test now exercises that sequence.

Seams inspected:

| Boundary                                                | Producer guarantee and consumer policy                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Equipment facts to capture to builder                   | Confirmed locations and captured names produce a cold opening snapshot; draft inclusion and emoji state stay in the frontend. Icon display leases retire when capture changes or the component unmounts.                                                                                                                        |
| Builder to drag owner to action cells                   | Valid immutable content crosses the existing gesture owner. Content identity, connection, lifecycle, cancellation, and placement distinguish drafts from saved-cell transfers. Successful placement closes the draft; cancelled placement retains it.                                                                           |
| Action cells to character settings to Electron disk     | Existing character-profile ownership persists the embedded snapshot. Reconciliation leaves loadouts intact; cloning, replacement, cell removal, and bar deletion require no second registry or cleanup pass.                                                                                                                    |
| Activation to host dispatch to core planning/submission | The app strips names and icons, preserving numeric item/null and target intent. Core resolves whole-item semantics and confirmed storage reservations, confirms peace when required, replans, and submits the burst without equipment-receipt progression. Shared world semantics choose the equipment-appropriate combat mode. |
| Core refusals to host projection to session toasts      | Original requested bindings survive projection. The session supplies captured names and full slot labels. Removal and wield attribution have distinct retirement needs; new submissions, unrelated item commands, world activation, and exit bound retained state.                                                              |
| Artwork to item/spell drag ghosts and themes            | Shared artwork bounds and CSS cursor clearance replace duplicate preparation/positioning. Gesture ownership and cancellation remain with the original controllers. Shared grid density and checkbox spacing retain frontend ownership.                                                                                          |

Consolidation review retained the existing single-item executor: its dependent receipt sequencing is a different contract from optimistic set submission. Both paths share equipment resolution and storage allocation. Removal/wield attribution also remains separate because a successful removal must not erase a later wield refusal. The equipment-submission capability in the shared session view is consumed by action-bar activation, although the drag controller itself does not invoke it; removing it would erase a real composition requirement. Test imports were grouped without changing behavior.

The added code has concrete consumers: snapshot validation/capture, builder controls, coordinated equipment planning/submission, and behavioral verification. No loadout registry, completion job, retry queue, or additional persistence owner was introduced. Live diagnostic code remains solely in the debug harness; browser fixtures remain solely in the browser harness. No production diagnostic switches were added.

Accepted limitations remain explicit: submission is optimistic; confirmed storage capacity does not credit speculative space freed by future wields; server failures have item identity but no activation ID, so repeated activations permit only best-effort latest-submission attribution. These are the agreed product contracts, not unresolved review blockers. This pass did not repeat live-server experiments or perform visual acceptance inspection, and does not constitute an audit of unchanged renderer, transport, or settings internals beyond the immediate feature seams.

Final review verification: all 667 core library tests, 374 host library tests, and 79 focused frontend/persistence tests passed. Core tests requiring local sockets initially failed under the sandbox and passed when rerun with socket permission. App type checks, ESLint, Knip, and Clippy with warnings denied for core, world, host, and debug-harness targets passed. The allegiance browser suite passed, including relationship alignment, theme density, remount, and stale-review cases. Rust formatting, scoped frontend formatting, and whitespace checks passed. The earlier full HUD/loadout and housing browser evidence remains applicable; the only subsequent product changes restore allegiance alignment and reorder accepted lifecycle retirement.
