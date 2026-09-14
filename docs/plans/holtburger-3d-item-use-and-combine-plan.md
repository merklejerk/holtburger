# Item use, combining, and action-bar integration

Status: implementation and automated verification complete. Visual/live-server acceptance remains user-owned.

## Goal and boundaries

Make ordinary item Use and Use with target available through inventory, selected-entity controls, the Interact hotkey, and action bars, with confirmation before a valid empty-mana-stone operation destroys its target.

In scope:

- Shared classification and operation evaluation using useability and target facts.
- Direct use and general combine-target acquisition across world, inventory, and self UI.
- Action-bar bindings for direct-use and targeted-use items, alongside equipment.
- Local destructive-use confirmation with exact-operation identity and revalidation.
- Existing busy admission, lifecycle cancellation, feedback, remappable input, and automated verification.
- Frontend-owned confirmation policy, backed by shared semantic evaluation and guarded execution.

Out of scope:

- Persistent layouts/bindings, automatic replacement-stack discovery, crafting recipes, salvage workflows, spell bindings, action queues, or cooldown/busy overlays on cells.
- Recreating server-side skill, quest, probability, and range rules in the frontend.
- Changes to TUI confirmation UX or mandatory confirmation policy for all existing core callers; a generic action/plugin framework.

Existing action-bar keyboard passthrough and inventory drag click/double-click suppression are baselines to preserve, not work to overwrite. Inspect the current diff before implementation rather than assuming its commit state. Commit authorization was subsequently supplied with the final code-quality review request.

## Ground truth and existing systems

| Reference                                                                                                                                  | What it establishes                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `crates/holtburger-world/src/context.rs`: `can_use`, `can_begin_use_with`, `can_use_with`                                                  | Source location admission and target type/location compatibility already shared with the TUI                                    |
| `crates/holtburger-world/src/interaction.rs`                                                                                               | Existing direct-use rejection and feedback, including deliberately permissive unspecified useability                            |
| `crates/holtburger-world/src/entity_facts.rs`                                                                                              | Semantic entity descriptions already projected to the frontend                                                                  |
| `crates/holtburger-common/src/properties/world_object.rs`, `inventory.rs`                                                                  | `ItemUseable`, `TargetType`, and usable source/target masks                                                                     |
| `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/inventory/tab.rs`                                                                | Combine before Use; class-specific Heal self and Recharge all shortcuts                                                         |
| `apps/holtburger-cli/src/pages/game/domains/inventory.rs`, `interaction.rs`                                                                | Existing targeted-use dispatch and combining lifecycle                                                                          |
| `ACE/Source/ACE.Server/WorldObjects/Food.cs`, `Healer.cs`, `ManaStone.cs`                                                                  | Authoritative consumption, healing, charging/draining, and target destruction behavior                                          |
| `acclient-eor-source/`                                                                                                                     | Verify retail combine cursor, target acquisition, and cancellation behavior before claiming parity; never modify this reference |
| `crates/holtburger-core/src/client/commands.rs`                                                                                            | Use and UseWithTarget already send protocol actions through `arm_busy_operation`                                                |
| `crates/holtburger-core/src/client/types.rs`                                                                                               | Existing commands and server-confirmation identities                                                                            |
| `apps/holtburger-3d/host/src/client_runtime.rs`                                                                                            | Typed host command dispatch, including direct Use and server confirmation replies                                               |
| `apps/holtburger-3d/src/client/client-entity-mirror.ts`                                                                                    | Frontend validation of shared entity facts                                                                                      |
| `apps/holtburger-3d/src/client/client-entity-interactions.ts`                                                                              | Selected display/health subscription and current non-owned-only interaction restriction                                         |
| `apps/holtburger-3d/src/client/client-pointer-selection-controller.ts`, `client-entity-selection.ts`, `client-selection-input.ts`          | Asynchronous world acquisition, selection identity, and input integration                                                       |
| `apps/holtburger-3d/src/client/client-dialogs.ts`, `ClientMessageDialog.svelte`                                                            | Session dialog arbitration, native modal presentation, and stale response handling                                              |
| `apps/holtburger-3d/src/client/client-action-equipment.ts`, `client-action-bar-state.ts`, `client-item-drag.ts`, `ClientActionBars.svelte` | Current equipment-only binding, drop, display, and activation seams                                                             |

Planning baseline: raw UseWithTarget checked busy state but did not itself apply the TUI's compatibility checks, and frontend descriptions lacked use capability. Guarded 3D use now applies shared evaluation; the TUI retains its existing raw command policy.

Source evidence resolved during plan refinement:

- Retail `acclient.c:414453-414488` enters `TARGET_MODE_USE_TARGET` for targeted use without a supplied target; a supplied selection goes through compatibility before submission.
- Retail `acclient.c:414615-414655` checks mana-stone item type `0x80000`, absence of the magical UI-effect bit `1`, and target retained flag `0x1000000`; retained targets are rejected and other compatible targets enter `TargetedUsageConfirmation_ManaStone`. The shared item-type and retained-mask definitions agree in `properties/inventory.rs` and `properties/object.rs`.
- ACE `WorldObject_Networking.cs:103-112` publishes useability, target type, and UI effects in public description data. `ManaStone.cs:53-56,109-111,184-185,221-222` broadcasts effect changes as stones charge or empty. Use this public charge indicator for the confirmation decision, not cached assessment mana totals. Verify initial absent-effect normalization through hydration in Phase 1.
- ACE `PropertyInt.cs:154-158` labels current/max item mana as assessment properties. These are not a prerequisite for ordinary use admission and may not be current.
- Retail clears its targeting object before compatibility evaluation at `acclient.c:414615-414618`. Keeping combine mode active after an invalid target is our agreed UX policy, not a claim of identical retail behavior.
- `ClientApp.svelte` owns session composition and game key routing. `ClientInventoryPanel.svelte` forwards cell clicks to selection; `ClientEntitySelection.selectInventoryItem` toggles selection. `ItemGridCell.svelte` currently exposes only a click callback. `ClientItemDrag` already suppresses post-drag clicks and double-clicks.
- The TUI already has local and server confirmation presentation in `pages/game/input.rs`, `render.rs`, and `domains/ui.rs`. Those callers keep their existing interaction policy. The 3D interaction controller owns its local questions; no new core confirmation workflow or TUI adapter is required.

## Ownership and guiding rules

| Layer                              | Owns                                                                                                                | Must not own                                                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Common/protocol/session            | Existing property primitives, wire actions, and transport                                                           | New UI modes, modifier policy, or fabricated server confirmations                               |
| World                              | Item use capability; source/target compatibility; known semantic consequences                                       | Action-bar precedence, cursor state, modal wording/layout                                       |
| Core                               | Evaluated use execution, busy admission, and semantic execution preconditions                                       | Selection gestures, confirmation policy/state, self-versus-selection policy, modal presentation |
| 3D host adapter                    | Typed translation of semantic evaluation and execution commands/results                                             | Reinterpreting item masks or choosing targets                                                   |
| Frontend session interaction owner | Entry-point coordination, combine source, confirmation policy/pending operation, target resolution and cancellation | Duplicating Rust classification or assuming cached UI facts authorize execution                 |
| Selection/picking owners           | Acquiring entity identities using existing geometry and correlation                                                 | Item compatibility and destructive-use decisions                                                |
| Dialog owner/component             | Presentation arbitration, accept/cancel, submission state and keyboard modality                                     | Executing a raw network confirmation for a local request                                        |
| Bars/cells/inventory panels        | Binding edits, presentation, and forwarding interaction intents                                                     | Independent combining or confirmation state machines                                            |

Compute semantic facts once in world. TypeScript switches on a validated capability discriminant; it does not decode useability, target masks, or mana-stone state. Binding capability is distinct from current operation eligibility. Preserve current ordinary world-object interaction behavior, including the explicit unrestricted-use path; it must not become a destructive-confirmation bypass.

### Dedicated frontend controller and cutover

Introduce **`ClientItemInteractions`** in `apps/holtburger-3d/src/client/client-item-interactions.ts`. The lifecycle-owner effect in `ClientApp.svelte` constructs one instance alongside selection, inventory, and dialogs; `ClientWorldView.svelte` passes its narrow intents to mounted consumers. It survives individual panel and action-bar mounts, cancels its current operation on character/lifecycle replacement, and is destroyed with the frontend client session.

Its public responsibilities are:

- Accept an explicit source identity for ordinary Use/Combine entry points.
- Accept action-bar activation with the existing alternate-modifier intent and resolve self/current selection at that moment.
- Accept a resolved target identity tagged with the current acquisition operation.
- Cancel the current interaction and expose a small presentation snapshot for the combine cursor/source prompt.
- Submit through narrow typed lifecycle-session capabilities and route evaluation/rejection feedback.

The controller owns the pending combine source, operation generation, local confirmation policy, exact operation awaiting approval, and acquisition/submission transitions. Model idle/acquiring/submitting/awaiting-confirmation as a discriminated union. It interprets world-produced consequences to decide whether to ask; it does not decode raw item properties, own pick geometry, or implement busy tracking. `ClientDialogs` presents the question and routes its local identity back to this controller. Core holds no local confirmation receipt or modal state.

The existing `ClientEntityInteractions` loses its direct-use dispatch responsibility. Rename its remaining selected-entity display/health-subscription owner to **`ClientSelectedEntityTracking`** in `client-selected-entity-tracking.ts`, updating composition, consumers, tests, and vocabulary in the same cutover. Selected HUD buttons and Interact input call `ClientItemInteractions` directly; the tracking owner does not become a forwarding wrapper.

`ClientInventoryState` remains an inventory facts/artwork/presentation owner. General action execution must not be added to its `interactions` port. Action bars receive the dedicated controller independently of inventory; panels and cells forward intents without owning their own combine state.

This is a focused frontend controller, not a generic interaction framework. World/core expose reusable operation semantics, while frontend composition owns the concrete selection, input, feedback, and dialog dependencies.

### Shared path and request boundaries

All entry points converge on the same item-use submission operation. Ordinary targeted use first acquires a target; action bars evaluate self/selection and fall back to that same acquisition flow when incompatible. There is no action-bar-specific validator, confirmation handler, busy check, or UseWithTarget dispatcher. Equipment remains a distinct existing equip operation invoked through the controller.

Keep these asynchronous boundaries explicit:

1. World picking returns an identity and acquisition token; cancelled/replaced picks cannot initiate a request.
2. Submit a correlated guarded use request containing source, explicit target when applicable, and the semantic consequence expected by the frontend. Initial automatic requests expect an ordinary, nondestructive consequence.
3. Core evaluates current facts. Invalid requests return rejection. A valid consequence differing from the expected consequence is returned without executing; matching requests proceed through existing busy admission. These are semantic preconditions, not a confirmation policy.
4. The frontend receives changed consequence facts, including affected identities/names. `ClientItemInteractions` applies its policy: a valid empty-stone destruction requires a local modal. It retains the exact source, target, consequence, and a local question identity.
5. Acceptance submits that same operation with the evaluated consequence as its execution precondition. Core re-evaluates; a changed consequence returns current facts without executing. The frontend retires the old approval and requires a fresh question for changed destruction. Invalid targets get rejection rather than a modal.

This avoids a mandatory preview round trip for ordinary operations while allowing the frontend to inspect an unexpected destructive consequence before sending it. A read-only eligibility query reuses that evaluator for hover cues and automatic action-bar target resolution; ordinary direct use still needs no preview. The precondition must describe relevant semantic identity (including affected item and quantity if the operation consumes part of a stack), not a global world revision or opaque approval token. Core neither knows nor enforces whether a human approved it. The 3D controller is responsible for never submitting destructive expectations automatically.

A rejected explicit attempt returns to acquisition only while its source/generation and retry permission remain current. Action bars enter explicit acquisition when their proposed automatic target is missing or incompatible; execution-time rejections remain feedback. Execution feedback means dispatched through core, not guaranteed server success. Host invoke completion alone means command delivery.

Cancellation guarantees apply before submission and to local unanswered questions. A submitted action may execute before cancellation; the UI must not claim to retract a sent wire action. Ignore stale result generations so they cannot open questions or initiate another request. No core cancellation/confirmation-response command is needed for a local question.

### Confirmation policy boundary

World supplies compatibility and typed consequences. Core supplies evaluation, execution precondition checks, and busy admission. Neither layer returns “confirmation required,” retains a pending question, or decides which consequences deserve approval.

`ClientItemInteractions` owns that decision for all 3D entry points. `ClientDialogs` shares presentation with existing server confirmations, but local responses return to the controller; server responses keep their existing protocol route. TUI callers keep their own frontend policy, without new shared-core receipts or adapter work.

Keep the unrestricted direct-world-use option narrow. It does not disable the 3D controller's destructive-use policy. Frontend operation generations use transport-safe correlation IDs for requests; question IDs remain frontend-local and are never core authorization receipts.

## Behavior contract

### Entry points

| Entry point                   | Direct use                                            | Targeted use                                                       |
| ----------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| Inventory item double-click   | Submit the item                                       | Begin combine mode                                                 |
| Selected-entity button        | Submit selected source                                | Begin combine mode with selected source                            |
| Interact hotkey               | Same operation as selected-entity button              | Same operation as selected-entity button                           |
| Action cell click or shortcut | Submit bound source; alternate modifier has no effect | Use eligible self/selection; otherwise enter explicit combine mode |

Action binding precedence is equipment, then targeted use, then direct use. Equipment retains existing main/off-hand and jewelry policy. General Use/Combine does not acquire action-bar equip precedence. “Use” does not imply consumption: supported usable tools can also qualify.

Inventory single-click retains selection; double-click invokes Use/Combine for that item through `ClientItemInteractions`. The selected-entity UI Interact button and Interact hotkey invoke the same flow for the selected item. No inventory context menu is introduced. Double-click must submit once and must not trigger after dragging. Supply the clicked source GUID directly: two preceding click events can toggle selection off, so reading current selection in the double-click handler is incorrect. Suppress the second selection toggle for a recognized multi-click sequence, preserving the clicked item as selected. If the first click was consumed as a combine target, consume the remainder of that click sequence, including its double-click event, rather than starting a new use operation on the target. Delegate inventory click/double-click handling at the panel boundary using the existing cell GUID attribute; keep `ItemGridCell` free of use policy.

Action-bar alternate uses the existing remappable modifier, default Shift. Resolve the target at activation, never at binding time. Missing or incompatible selection enters explicit combine mode without falling back to self. Ordinary activation uses self only when shared validation accepts the player, which includes the creature target mask. Keep bindings tied to their original item GUID/stack; disappearance leaves an unavailable binding. Do not forbid binding a tool solely because self is not a compatible target.

### Combine mode

- Retain the source identity and an operation generation. Show a bullseye cursor over targetable surfaces and a visible “Use [source] on…” prompt.
- The next world entity, inventory item, or explicit player/self target activation attempts that pairing. A target click is consumed rather than also performing the ordinary click action.
- Invalid target or empty-space click leaves mode active; explain rejected entity pairings without submitting a game action.
- A valid target ends acquisition and enters execution or confirmation. Both the selected-entity Interact button and Interact hotkey attempt the current selection while combining; with none selected they report that a target is required. Selection cycling and Select Self only update selection; they do not implicitly submit it.
- Escape cancels; movement and unrelated keyboard input continue. Source removal/loss of ownership, character replacement, resync, world exit, window blur, and controller destruction cancel pending acquisition.
- Starting another explicit use/action replaces pending acquisition. Item dragging cancels acquisition when crossing the existing drag threshold, not on pointerdown (which must still allow an inventory target click). Layout manipulation, precise-jump entry, or opening an unrelated modal cancels acquisition. Beginning combine cancels precise-jump mode and clears action-bar keyboard selection. Opening this operation's own confirmation ends acquisition without cancelling its locally retained operation.
- Async pick/evaluation replies carry the operation generation. Replies from cancelled/replaced operations cannot initiate a committed request or open a modal. Existing selection intent checks remain effective for ordinary selection; combine picks use their own explicit destination/token and do not publish an intermediate selection.
- Route Escape through existing keyboard ownership: modal dismissal first, then active item drag, combine acquisition, precise-jump mode, action-bar selection, and ordinary deselection as applicable. Mutually exclusive modes are cancelled on entry rather than competing through global listeners. Retain the existing editor/composition rules and remappable game cancel command.
- Provide an explicit self target on the player HUD through the same GUID target callback; do not depend on being able to pick the rendered player mesh. This is a target affordance while combining, not a new general player-panel click action.
- Cursor state expresses combine mode, not guaranteed compatibility on hover. Reuse picking; do not add host validation requests for every pointer move.

### Destructive confirmation and busy admission

The world evaluator returns rejection or a valid typed consequence, never a UI instruction. The frontend asks before a valid empty-mana-stone drain, naming the affected item and destruction. Invalid pairings never open a confirmation. Use known public item type, magical-effect bit, and retained flag for shared consequence evaluation. Missing description hydration is unavailable; do not request assessment-only mana totals. “Valid” means compatible according to public facts, not guaranteed server success. Reject retained targets and empty-stone self-use from proven semantics.

The frontend retains one exact pending question with a unique local ID, source, target, and evaluated consequence. Accept addresses that local ID and submits the retained operation, never a newly selected target. Transition to submitting synchronously so duplicate responses cannot submit twice. Core revalidates compatibility, character lifetime, and the expected consequence immediately before execution. Changed consequences return facts without executing; unrelated world revisions alone do not invalidate the expectation.

Do not mark the character busy during acquisition or a local question. At execution reuse `arm_busy_operation`; busy rejection retires the submitted question and reports failure without queueing. The modal disables duplicate responses while submitting.

Local questions are tagged separately from server confirmations. Server questions retain priority and cancel any pending local item-use question in the frontend. Lifecycle replacement retires the controller's question and presentation together; remounting the session does not restore local questions from core snapshots. Server confirmation state and response behavior remain unchanged.

## Implementation phases

### Phase 1 — Prove and centralize semantics

- [x] Implement the public mana-stone predicate established above; verify initial omitted UI effects normalize correctly only after description hydration, and updates after draining/recharging replace that fact. Cover known retained and self-target rejection. Do not gate use on assessment-only mana totals.
- [x] Carry the established retail use/confirmation citations into relevant shared semantics. Inspect remaining cursor asset/mode details only as needed; the bullseye and invalid-target retry policies above are the intended UX.
- [x] Extend shared world use helpers with a typed capability and pure operation evaluation. Reuse existing mask/location checks; distinguish unsupported, unavailable facts, and incompatible target.
- [x] Project capability via `entity_facts.rs` and the frontend mirror; verify relevant property/location changes republish facts. Do not add per-target outcomes to every entity snapshot.
- [x] Add focused tests for direct use, targeted use, unspecified/NO useability, ownership/location changes, healing, charged/empty stones, and incomplete facts.

Acceptance: capability decisions are produced in Rust; destructive classification is supported by actual observable facts; existing world Use semantics remain intact. No modal or action-bar-specific behavior enters world.

### Phase 2 — Semantic evaluation and guarded execution

- [x] Add a correlated guarded item-use request carrying explicit identities and expected consequence. Return rejected, consequence-changed (with evaluated facts), or executed. Do not add confirmation-specific core outcomes or a mandatory preview request.
- [x] Compare semantic consequence preconditions immediately before execution and reuse busy admission. Keep evaluation/dispatch shared; core does not interpret the expectation as proof of user approval.
- [x] Preserve TUI command policy without new confirmation UI or receipt plumbing. All 3D use entry points share the frontend controller and guarded execution port.
- [x] Extend host allowlists, MessagePack decoding, result delivery, frontend schemas, and lifecycle session methods together. No new core pending-confirmation state, receipt allocation, snapshot field, or confirmation-response command.
- [x] Test invalid pairing, unexpected destruction without execution, matching consequence execution, changed source/target/consequence, character lifetime, busy rejection, and existing server feedback.

Acceptance: core exposes facts and enforces execution preconditions; it never decides to ask a question. Initial ordinary expectations cannot accidentally execute destruction. Existing server confirmations remain unchanged.

### Steering checkpoint

Implementation evidence so far: public use-capability changes reconstruct correctly through core's entity publisher; targeted world/core tests prove mismatched consequences send nothing and do not acquire busy state. Core now also checks the source ownership captured by the frontend. The 3D controller owns all local question state; no core receipt or TUI adapter was introduced. Ordinary target retry allocates a new acquisition generation so an older pending pick cannot become current again.

Browser verification passed ordinary double-click Use, target retry, local confirmation acceptance with a captured target, the selected Interact button, configured Interact hotkey, and real drag binding/activation of both direct and targeted action cells. Keyboard ownership restoration now cancels acquisition only, so closing an accepted dialog cannot retire its submitted operation. Double-clicking an already-selected source restores that selection before activation.

The browser integration retains existing drag suppression. Its fixture must wait for the previous action-bar drag's double-click suppression window before starting an independent double-click scenario. Mixed action bindings now compare each cell's retained kind against the item's current binding kind, rather than sharing an availability boolean by GUID.

- [x] Dry-run food, healing another player, charged stone on self, empty stone on an owned item, and missing charge facts through the implemented contracts.
- [x] Confirm the contracts carry enough information for UI without decoding masks or requesting a broad inventory refresh on each hover.
- [x] Reassess source facts, cancellation ownership, and TUI impact before building UI. Resolve evidence gaps here, rather than compensating in TypeScript.

### Phase 3 — One general Use/Combine interaction flow

- [x] Add `client-item-interactions.ts` with `ClientItemInteractions` and focused controller tests. Wire one instance into the client-session composition root with narrow selection, lifecycle-command, and feedback dependencies; pass it to inventory, selected HUD/input, and action-bar consumers.
- [x] Rename `ClientEntityInteractions` / `client-entity-interactions.ts` to `ClientSelectedEntityTracking` / `client-selected-entity-tracking.ts`. Remove its use dispatch, update tests/imports/composition, and route selected interaction directly to the new controller. Preserve health-subscription lifetime and selected display behavior.
- [x] Model idle, acquiring, awaiting-confirmation, and submitting states in the frontend controller. Own local question IDs and exact operation snapshots there; apply confirmation policy to evaluated consequences. Ignore stale result generations and distinguish pre-submission cancellation from already-submitted execution.
- [x] Connect resolved world clicks through the existing picking pipeline. Add an explicit target-acquisition destination/token rather than observing all ordinary selection changes as target clicks.
- [x] Use panel-level delegated inventory events for direct-GUID double-click activation, multi-click selection handling, and consumed target-click sequences. Reuse `ClientItemDrag` post-drag suppression and add an actual-drag-start cancellation hook. Wire a player-HUD self target without requiring world-mesh picking.
- [x] Add bullseye cursor and source prompt; wire `ClientApp.handleGameKeydown`, keyboard gesture cancellation, and `ClientInputArbiter` with the explicit mode priority above. Cover precise-jump/combining replacement, action-bar selection, modal entry, and held movement.
- [x] Wire inventory item double-click, the selected-entity HUD Interact button, and the Interact hotkey to the same controller. Remove the blanket owned-item interaction exclusion; use shared capability facts.
- [x] Extend `ClientDialogs` and `ClientMessageDialog` with tagged local questions, server-priority arbitration, errors, and duplicate-response handling. Route local accept/cancel to `ClientItemInteractions`; retain existing server response dispatch. Test local question replacement, double acceptance, changed consequence, and session teardown.

Acceptance: all three ordinary entry points use the same classification and execution path; invalid targets leave combining active; cancellation prevents late picks/results from acting; destructive confirmation is identical regardless of entry point.

### Phase 4 — Extend action bars

- [x] Generalize equipment-only action content, classification/display vocabulary, and drag admission. Replace `client-action-equipment.ts` with an honestly named shared item-action helper and update all surviving references.
- [x] Route activation through the session item-interaction owner rather than growing `inventory.interactions` into a general command service.
- [x] Preserve equipment precedence and alternate-side behavior; direct Use ignores alternate; targeted Use resolves self/current selection immediately and bypasses interactive target acquisition.
- [x] Keep unavailable bindings, sparse slots, swaps, clear-on-drop-out, icon leases, and equipped indicators correct for mixed action kinds.
- [x] Exercise click and remapped keyboard activation with fresh facts, source removal, missing selection, and destructive confirmation.

Acceptance: all supported owned item kinds bind through the existing drag path; bars and ordinary UI share execution/confirmation; no layout or keyboard regression and no second use classifier in TypeScript.

### Phase 5 — Cleanup and integrated verification

- [x] Review the accumulated diff across world → core → host → mirror → interaction → picking/dialogs/bars, including resets, rejection paths, and immediate TUI callers.
- [x] Remove equipment-only messages/types that now describe all items, duplicated use dispatch, stale tests, and temporary asset-dependent diagnostics. Keep meaningful synthetic regression fixtures.
- [x] Run affected world/core/host tests, frontend checks and focused tests, Rust formatting and clippy with warnings denied, TypeScript lint/dead-code checks, and touched-file formatting.
- [x] Run `npm run harness:browser -- --client-hud` with actual pointer/key cases for target acquisition, direct use, invalid target recovery, cancellation races, confirmation arbitration, and action-bar modifiers. Do not run the interactive TUI.
- [x] Hand the user a concise visual/live-server acceptance checklist and report any remaining evidence limitations. User performs visual and interactive acceptance; automated gates remain implementation-owned.

Required end-to-end scenarios for the implementation gates:

| Scenario                                             | Expected result                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Double-click food after ordinary inventory selection | One direct-use request for the clicked GUID; no reliance on a toggled selection          |
| Double-click a healing kit, then click a player      | One correlated use request; rejection keeps the current source active                    |
| Double-click a target while already combining        | One target attempt; trailing click/double-click does not start target use                |
| Shift action-bar use with no selection               | Explicit combine mode, no automatic self fallback or use command                         |
| Empty stone on compatible unretained owned item      | Frontend question naming target; accept submits once; decline sends no execution request |
| Empty stone on retained item or self                 | Rejection without confirmation                                                           |
| Charge changes while confirmation is displayed       | Core returns changed consequence without execution; frontend retires old approval        |
| Escape/new source during delayed pick                | No use request from the stale pick                                                       |
| Cancel before delayed consequence result arrives     | Stale result cannot open a local question or cause another submission                    |
| Server confirmation arrives during local question    | Frontend local question cancelled; server question shown; stale local accept ignored     |
| Interact during combining after cycle/self selection | Current selection is used as target, not reinterpreted as a new source                   |

## Risks, concessions, and decisions to track

- Public UI effects govern the client confirmation decision; assessment-only mana totals cannot establish current server success. Keep that distinction in evaluation names, tests, and feedback.
- Useability UNDEF is currently permissive. Preserve documented shared semantics rather than introducing an item-type allowlist or implying successful server use.
- Adding a local confirmation changes frontend controller state and dialog arbitration. Keep tagged request identities and explicit retirement instead of parallel indistinguishable confirmation fields.
- Async target acquisition can race Escape, a new source, modal activation, and scene reset. Operation identity is required at each asynchronous return boundary.
- Inventory double-click, selected-entity Interact, and the Interact hotkey are agreed entry points. Verify double-click ordering against selection, drag suppression, and active combine target acquisition; no context menu is in scope.
- Confirmation describes the known requested consequence, not a transaction lock on server state. Server rejection after acceptance is an ordinary outcome.
- No automatic binding refill, automatic retry, or deferred busy queue. Users explicitly trigger a new operation after failure.

## Definition of done

- [x] Inventory double-click, the selected-entity Interact button, and the Interact hotkey support direct Use and interactive Combine through the same controller, with one submission per activation.
- [x] World, inventory, and self target acquisition work without duplicate click effects or stale completion.
- [x] Action bars accept equipment, direct-use, and targeted-use content with agreed modifier behavior.
- [x] Valid destructive empty-stone use requires confirmation of the exact target; invalid use does not show a modal.
- [x] Busy admission is reused only at execution; lifecycle changes retire targeting and confirmation.
- [x] Classification and compatibility remain shared Rust semantics; UI owns targeting and presentation.
- [x] Required automated checks pass; user visual/live-server acceptance is explicitly recorded separately.

Evidence work completed: omitted UI effects, public fact republishing, and a local SVG bullseye cursor are implemented and covered by the shared tests/browser harness. The public charge predicate and retail targeted-use/confirmation path are now source-grounded. Confirmation policy and pending questions belong entirely to the frontend; core only evaluates and checks execution preconditions. No user decision is required to proceed with the specified behavior.

## Implementation verification and user acceptance

Automated evidence from the completed implementation:

- World: 786 tests passed; core: 446; 3D host: 298. These cover capability publication, compatibility, consequence mismatches, ownership/character checks, wire admission, and busy behavior.
- Frontend: 292 test files / 2,342 tests passed, including controller cancellation/approval, source removal, stale target picks, selection preservation, and existing input/action-bar behavior.
- `npm run check`, `npm run lint:ts`, `npm run lint:dead`, affected Rust clippy with warnings denied, touched frontend formatting, Rust formatting, and `git diff --check` passed. `cargo check -p holtburger-cli` passed without running the TUI.
- `npm run harness:browser -- --client-hud` passed with native pointer/key probes for ordinary use, target retry, consumed double-click sequences, local confirmation acceptance, exact target retention, selected Interact, the configured Interact shortcut, Escape, and direct/targeted drag bindings with self/alternate targets. Existing action-bar and keyboard probes also pass.
- Removed the obsolete 3D raw `use_client_entity` host/session route; all 3D entry points use guarded submission. Existing core Use commands remain for the TUI.

Implementation adjustment: inventory activation uses delegated events at the panel boundary instead of expanding generic item-cell callbacks. The existing cell GUID attribute serves all inventory sections and equipment cells, and generic cells remain independent of item-use policy.

User-owned acceptance (not claimed as automated/live-server evidence):

1. Double-click food; double-click a healing kit and pick a world player, inventory target, or **Use on self**. Check the bullseye/prompt and invalid-target feedback.
2. Bind food, a healing kit, and a charged mana stone to bars. Trigger by click and hotkey; check self targeting and Shift/current-selection targeting, including no selection.
3. Use an empty stone on an expendable compatible owned item. Check the named destruction question, decline, accept, and retained/self rejection.
4. Check movement while combining, Escape, layout/drag cancellation, and equipment behavior. Assess cursor, prompt, dialog, and mixed-cell presentation visually.

The client validates public facts and known consequences; live server success still depends on authoritative server state (including healing skill, charges, and target eligibility). No live client session was run for these gates.

## Final code-quality review

Review boundary: accumulated feature diff against HEAD, including the earlier keyboard passthrough change, all new/untracked source/tests and this plan. ACE/ACViewer untracked submodule contents are unrelated and excluded.

Seams inspected: world capability/evaluation → core guarded execution and existing raw TUI dispatch → host command/projection/MessagePack events → frontend schemas/lifecycle → interaction controller → inventory double-click, action bars, selected Interact, pointer picking and dialogs. Also inspected action binding/display leases and keyboard press/release routing. Public property publication and server/reference behavior were checked for the mana-stone consequence and target masks.

Findings fixed before commit:

- Dialog presentation retained its item subscription unless composition unbound before destruction. The dialog owner now owns the subscription lifetime; destruction clears it and delayed release is idempotent.
- Keyboard callers duplicated acquisition-state policy, and cancellation during submission retained a retry that could revive targeting on rejection. `ClientItemInteractions.cancelTargeting` now owns this transition, preserving dispatched results while retiring retry permission. Both command-error and correlated-rejection paths are covered.
- Target absence was checked only after shared compatibility had already established target existence. The evaluator now reports missing targets before compatibility checking, making that rejection branch reachable and specific.
- Removed the unused equipment command from the inventory drag port and its fixtures; equipment activation now belongs solely to the interaction controller. Restored the pointer controller's destruction guard before it allocates a selection intent.
- The selected HUD no longer disabled explicit NO items when the existing unrestricted-use diagnostic option is enabled. Pending/unavailable descriptions remain disabled; targeted sources still require targets.
- Updated superseded targeting-policy text: action bars now evaluate self/selection and fall back to explicit acquisition.

Accepted tradeoffs: explicit correlated local IPC keeps semantic validation in Rust; hover refresh currently follows entity-fact notifications as well as target changes. Eligibility remains public-fact compatibility rather than server-success prediction. The narrow request/event plumbing follows the existing typed host transport rather than introducing a generic interaction framework. Fixed SVG cursor assets remain frontend presentation; runtime tunability was discussed but not requested for this change.

Not claimed by this review: live-server success, visual acceptance, complete server item-specific eligibility, or a general audit of unchanged movement/rendering/transport internals. User-owned acceptance remains listed above.
