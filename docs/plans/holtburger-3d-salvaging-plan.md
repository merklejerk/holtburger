# H3D salvaging implementation plan

Status: implementation and automated verification complete. User visual acceptance remains pending; no visual acceptance was performed by the agent.
Updated: 2026-10-24. Authorization: implement the plan; stop for a major blocker/gap or user visual acceptance.

## Goal and boundaries

Salvage manually chosen inventory items through a cohesive floating work window, entered through ordinary Ust use or the selected-entity HUD.

In scope: shared tool discovery and candidate/batch evaluation; guarded submission; typed host contracts; a local queue and output preview; selected-HUD action; inventory drag/drop; existing confirmation and inspection behavior; result-message decoding; lifecycle cleanup; focused automated verification. Consolidating the TUI's existing tool discovery and eligibility assembly is part of the shared semantic cutover, without redesigning its UX.

Out of scope: an Add selected button, permanent HUD launcher, new global shortcut, inventory double-click overrides for ordinary items, automatic selection, salvage-all, material filters, workmanship buckets, recursive whole-pack salvaging, new character-settings UI, confirmation suppression, or a general transaction framework. No visual acceptance checks by the implementation agent, no TUI launch, and no commits unless requested.

## Ground truth and existing patterns

Paths below are relative to the repository root.

| Source | Evidence / implementation use |
| --- | --- |
| `ACE/Source/ACE.Server/WorldObjects/Player_Crafting.cs`, `ToolIsValidUst` and `HandleSalvaging` | Exact Ust template and recursive root ownership; per-item processing; trade/retained checks; consumption and bag creation; optional result messages grouped by skill |
| `ACE/Source/ACE.Entity/Enum/WeenieClassName.cs` | `W_TINKERINGTOOL_CLASS = 20646`; give this value one named shared owner |
| `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventSalvageOperationsResult.cs` and `Network/Structure/SalvageResult.cs` | Skill, rejected-GUID list, result rows, augmentation bonus; each row is material u32, workmanship f64, units u32 |
| `acclient-eor-source/acclient.c:383278` (`CPlayerSystem::UsingItem`) | Ordinary tool activation opens the salvage panel locally (case 6); no generic server Use required |
| `acclient-eor-source/acclient.c:241722` (`gmSalvageUI::IsItemSuitable`) | Material suitability, retained/full-material restrictions, existing multiple-material preference |
| `acclient-eor-source/acclient.c:242140` (`gmSalvageUI::Salvage`) | A submitted queue is cleared; submission is distinct from inventory confirmation |
| `acclient-eor-source/acclient.c:477121` and `:477169` | Full result-packet list layout, including a rejected-item list even though ACE writes an empty list |
| `acclient-eor-source/acclient.c:476994` and ACE `Player_Crafting.MaterialSalvage` | Matching sets of 72 usable output materials; excludes Unknown and category headers (IDs 0, 3, 9, 56, 65, 72) |
| `ACE/Source/ACE.Server/WorldObjects/{WorldObject_Networking,WorldObject_Properties}.cs`, `crates/holtburger-world/src/{hydration,entity_public_description,identify}.rs` | Public workmanship is an average float; appraisal supplies integer total/count. The original hydration cast the average into `ItemWorkmanship`; this slice now preserves the two forms separately. |
| `ACE/Source/ACE.Server/WorldObjects/{Container,Player_Inventory}.cs` | `GetInventoryItem` searches recursively carried containers, excluding equipment; salvage's default consume amount removes the whole stack |
| `crates/holtburger-world/src/crafting/salvage.rs`, `src/context.rs`, `src/player/types.rs` | Existing predictor and candidate helper; existing mapping for `SalvageMultipleMaterialsAtOnce` |
| `apps/holtburger-cli/src/pages/game/salvaging.rs`, `domains/inventory.rs` | Current frontend assembly and broad item-type tool search to consolidate |
| `crates/holtburger-core/src/client/{commands,item_use,types,messages}.rs` | Existing salvage wire dispatch, guarded-use request/result precedent, busy admission, server-message handling |
| `apps/holtburger-3d/src/client/ClientVendorWindow.svelte`, `ClientTradeWindow.svelte` | Queue/drop feedback, item cells, remove/Clear controls, inspection, footer actions |
| `apps/holtburger-3d/src/client/ClientSelectedEntityHud.svelte` | Existing eligible-action list: direct action for one entry, popup menu for several |
| `apps/holtburger-3d/src/client/{client-item-interactions,client-item-drag,client-dialogs}.ts` | Single activation owner, single drag owner, local confirmation routing |
| `apps/holtburger-3d/src/client/{ClientHudWindow.svelte,ClientGameplayView.svelte,ClientApp.svelte,client-hud-layout.ts,client-ui-defaults.ts,client-settings-contract.ts}` | Window composition, session lifetime, saved placement and defaults |
| `crates/holtburger-core/src/client/entity_facts.rs` | Property/appraisal changes dirty the affected entity; storage changes dirty owned descendants; trade revision changes dirty retained records. Skill and character-option changes currently do not dirty every candidate. |
| `apps/holtburger-3d/host/src/{client_runtime,client_projection,protocol}.rs`, `src/lib/host/host-transport.ts` | Command enum/dispatch/allowlists and host event mapping; host invoke success means command enqueue, not game-action dispatch |
| `apps/holtburger-3d/src/client/ClientActionBars.svelte`, `client-selected-entity-tracking.ts` | Action bars construct the shared drag owner; bound activation bypasses `use()`; selected Interact eligibility explicitly lists capability variants |
| `apps/holtburger-3d/electron/client-settings-store.ts` | HUD placements are independently saved/read entries, so adding a placement does not require a file-version migration |

ACE remains authoritative for server behavior. Retail establishes frontend behavior, not a requirement to reproduce its architecture. Do not modify the decompile. The replaced candidate boolean and predictor input assembly admitted category-header materials and confused public averages with appraised totals. The shared cutover corrects both issues.

## North stars

- The frontend owns draft, window, and confirmation policy. World owns game facts; core owns admission and dispatch; protocol owns deterministic wire decoding; host only adapts typed requests/events.
- Compute salvage decisions once in Rust. Project the semantic result rather than teaching TypeScript WCIDs, raw properties, or yield formulas.
- Review the exact ordered batch that will be sent. Preserve source identities and whole-stack quantities; output is an estimate, never an inventory prediction applied locally.
- Start from the existing predictor, command, cell artwork, dialog owner, and drag controller. Extract only demonstrated shared UI responsibilities.
- No automatic retries and no server-success claim based on a local send. Result messages cannot serve as a completion barrier.

## Behavior and ownership

| Layer | Change and named consumers |
| --- | --- |
| World | One Ust predicate/discovery helper; candidate evaluation with explicit reasons; ordered batch evaluation assembling predictor inputs and skill/augmentation profile. Consumed by core, entity facts, and existing TUI paths. Multiple-material preference is frontend queue policy, not server admission: project the existing option for h3d to honor; no new settings UI. |
| Core | Correlated discovery/preview and guarded-submit requests/results in a focused `client/salvage.rs`; current character, world/busy/inventory admission, fresh evaluation, comparison against reviewed facts, then existing salvage action. Consumed by h3d and reusable beyond it. |
| Entity projection | World-produced candidate facts consumed by selected-HUD eligibility, drag feedback, and draft invalidation. Ust classification is an authored-use capability consumed by ordinary activation. Add one shared salvage context to the existing snapshot/delta for profile/preference changes; no skill-dependent candidate flags. |
| H3D host/session | Typed adapters and schema-validated request/result transport; no independent salvage state machine or raw-property queries. |
| H3D frontend | One session-owned `ClientSalvageState`; `ClientSalvageWindow` presents its sampled view and dispatches gestures. Draft state survives window raising, not explicit closure or character-session replacement. |

### Concrete contracts and publication dependencies

Use the following narrow shapes (names are proposed; responsibilities are fixed):

- `SalvageCandidate`: `ineligible { reason } | pending-details { material } | ready { source }`. Valid public material/workmanship can establish a candidate before the appraisal facts required for a trustworthy batch preview arrive. Missing preview details must not hide the HUD action or cause a queued source to be silently dropped. Per-item normalization contains quantity, material, structure, raw workmanship total/contributor count, and `Entity::instance_sequence()`; include the tool's instance sequence in the review too. Candidate admission rejects equipment and non-empty containers; it does not infer salvageability from ordinary trade admission. Unknown container contents cannot establish that a container is empty.
- `SalvageContext`: world-produced skill profile plus existing multiple-material preference, carried in `ClientEntitySnapshot` and as an optional replacement in `ClientEntityDelta`, like projectile supply. The frontend compares this value for invalidation and uses only its preference for queue policy; it never calculates yield. In `EntityFactsPublication::collect_with_opened`, compare the normalized context every collection and emit only when changed. Call `publish_entity_facts()` after `set_character_option` completes, as well as existing world-event collection. Existing snapshot recovery carries the same context.
- `SalvagePreviewRequest { sequence, player, tool, items }`: tool selection is `exact { guid } | discover { preferred }`; `items` is an ordered GUID list, empty for opening an Ust window. A discovery query with the proposed full draft can discover the tool and validate the prospective addition in one coherent response. Preview results are `ready { review, bags } | pending-details { items } | rejected { reason }`, with resolved tool identity on accepted pending/ready responses. No separate discovery API or server reservation.
- `SalvageReview`: character/tool identity, ordered normalized sources, and the normalized yield profile. Compare this integer/source evidence, not floating output rows and not a global world revision. Material preference is omitted from server approval because ACE accepts mixed batches irrespective of that frontend preference. A changed preference cancels the local question instead. Empty previews are valid; empty submissions are rejected.
- `SalvageSubmitRequest { sequence, review }` and result `dispatched | changed { fresh evaluation } | rejected { reason }`. Every admission path produces exactly one correlated result. The frontend clears only on this `dispatched` event, never on the host invoke promise resolving. A preview stays pending until its correlated event arrives; enqueue acceptance is not an evaluation.

Separate candidate evaluation (per entity) from batch composition (profile and ordered draft). Existing entity invalidation already covers appraisal/properties, recursive ownership changes, and trade revisions. Add tests for those paths, and add context replacement for skills/augmentation/options rather than dirtying all candidates. A candidate/source value or context change triggers a coalesced preview request. Unrelated movement/name/artwork updates do not repeatedly request previews or revoke approval. The frontend keeps at most one preview request in flight and schedules one fresh request if dependencies changed meanwhile.

The TUI's `GameData` already retains the shared semantic entity records. It consumes their candidate/readiness and normalized source values directly rather than reconstructing world storage/trade admission from its read model. The existing `WorldContext` remains sufficient for shared Ust discovery; no salvage-specific defaulted methods were added. Shared profile construction accepts the existing skill iterator/augmentation inputs. The TUI preview now returns ready/error explicitly instead of silently filtering incomplete sources out of the batch. The multiple-material restriction remains local to h3d's queue.

### Data prerequisites and pending details

Preserve public average workmanship separately in `EntityPublicDescription`; remove the `pwd.workmanship as i32` write into raw `PropertyInt::ItemWorkmanship` in `hydration.rs`. Appraisal/property updates remain the source for raw totals/counts. Sweep direct consumers of `workmanship()` / `effective_workmanship()` and vendor hydration when removing that false raw fact; use a named shared accessor for display-average evidence where public values are appropriate. Do not synthesize a raw total from a fractional average or let a later public recreation overwrite appraised totals. For example, an average of 7.25 with eight contributors implies a raw total of 58; truncating the average to 7 and dividing again produces 0.875.

For this slice, exact batch previews require normalized raw inputs from authoritative property/appraisal evidence. A pending candidate may join the draft, but estimated output and Salvage remain unavailable with explicit guidance to Examine the affected item. Use existing Examine/right-click inspection to obtain details; a failed appraisal leaves an actionable pending explanation. No automatic appraisal retry controller is added. Default contributor count to one only after a successful appraisal establishes that the property is absent, matching ACE's default; absence before appraisal is unknown. Update the touched TUI preview presentation with the same pending explanation, without changing its layout or controls.

Normalize the tinkering skill choice against ACE: `GetMaxSkill(TinkeringSkills)` selects highest current value first, then checks that chosen skill's training; current `best_trained_tinkering_skill` filters training first and can disagree. Replace that assembly with the ACE rule and fixed source tie order. Check predictor rounding/overflow arithmetic against ACE's `GetStructure`/`TryAddSalvage`, using synthetic fractional-workmanship and split-bag boundary cases. Keep the current bag-packing algorithm unless these cases prove a necessary correction; document actual compatibility choices with repository retail markers when applicable.

### Entry points and window

1. **Use an Ust:** open an empty window on first entry. Reusing the current tool/window raises it without clearing the draft. Another owned Ust may replace the tool only after evaluation; preserve the queue and invalidate prior approval. Route ordinary inventory/selected activation and any existing action-bar activation through the same frontend owner. Tool classification is shared; opening a window remains frontend policy. Do not accidentally dispatch generic Use or start target acquisition for this local action.
2. **Selected HUD → Salvage:** show for an eligible carried item even without an Ust. Capture its GUID on activation; shared discovery finds an owned Ust, preferring the current valid tool, otherwise a deterministic candidate. If absent, report `You do not have an Ust in your inventory.` and leave the window/draft unchanged. On success, open/raise the window and append the item. Repeated activation never duplicates it. A stale/ineligible selection produces a reason and is not queued.
3. **Drag into window:** extend `client-item-drag.ts` with one salvage target using existing feedback/ghost behavior. Source remains in inventory. Validate against fresh shared facts before adding. Whole stacks are queued; existing split UX is used beforehand for partial quantities. Containers are not recursive bulk input.
4. Queue cells retain individual identities, stack counts, selection, existing Examine/right-click inspection, and remove controls. Show an empty drop hint, Clear, estimated output rows per resulting bag (material/units/workmanship), destruction guidance, and `Salvage N items`. Count queue entries consistently; display stack counts separately to avoid implying partial-stack destruction.
5. Use `ClientHudWindow`, normal resizing/placement persistence, theme controls, existing keyboard ownership, and bounded display sampling. Bring inventory forward when entering salvage. No Add selected button and no change to ordinary inventory double-click semantics.

When `SalvageMultipleMaterialsAtOnce` is off, h3d accepts only the first queued material; removing the last source releases the restriction. A rejected addition leaves the existing queue intact. If the option turns off with a mixed draft present, retain all entries, cancel any question, and explain that materials must be removed until only one remains. Do not silently choose which items the user should destroy. Core's source-safety validation remains usable by scripting/TUI without imposing this frontend preference.

Implement Ust activation as a semantic `ItemUseCapability::SalvageTool` (wire spelling `salvage-tool`), not a window command in world/core. Extend the strict `client-entity-mirror.ts` enum, `bindingAction` (map this capability to the existing direct binding kind), and `client-selected-entity-tracking.ts`'s `canInteract`. Both `ClientItemInteractions.#useAuthored` and bound `activate` must call one local tool-activation helper before generic direct/targeted routing; inject `beginSalvage(toolGuid)` from `ClientApp`. Ordinary Ust activation sends neither `submit_client_item_use` nor a target query. Preserve the existing unrestricted diagnostic-use path; ordinary activation is the path covered here.

### Approval, transport, and lifecycle

```text
HUD action / Ust use / drop
  → shared discovery + evaluation
  → app-owned draft + estimated output
  → existing local confirmation
  → core re-evaluates reviewed ordered inputs
      changed/rejected → retain draft, refresh preview, require review
      dispatched       → clear submitted draft; no success claim
  → authoritative inventory updates + optional salvage result chat
```

- Proposed state union: `closed | editing | confirming | submitting`. Each asynchronous request has a globally unique correlation identity; closing retires the active pending request. Editing owns a pending/ready/rejected evaluation rather than several interdependent boolean flags. Local confirmation binds to an immutable evaluated batch, not mutable selection.
- The reviewed contract contains character/tool identity and ordered source GUIDs with normalized facts that determine destruction and yield, including whole-stack amounts and the yield profile. World constructs that comparison value; core compares it with a fresh evaluation. Consumers do not re-derive it or use a global world revision that invalidates on unrelated movement. Frontend material preference is separately handled as queue policy above; no host-issued approval token or server reservation.
- Freeze draft mutation during confirmation/submission. Cancel returns to the current draft. Changes to relevant facts invalidate the confirmation; missing/ineligible sources are removed with an explanation and the preview is refreshed. Other inventory moves that preserve eligibility need not discard the draft. Revalidate at submission even when frontend notifications have not caught up.
- Use the existing dialog owner with Salvage/Cancel and no typed input or suppression. Backdrop/Escape cancellation follows its existing policy. Ordinary panel clicks retain game keyboard ownership.
- A local correlated `dispatched` result means the action entered transport. Clear only the submitted draft, then remain open for another batch. Validation or definite local dispatch rejection retains it. A transport disconnect after possible dispatch is uncertain: retire the interaction and never retry automatically.
- Ignore stale discovery/preview results after closure/reopening or edits. A late submit result cannot clear a replacement draft. Never optimistically delete inventory items or synthesize salvage bags.
- Closing discards the local draft and cancels any local question; it does not cancel a sent game action. Loss of tool ownership or departure from in-world state retires the draft, including portal entry. Switching selection alone does not clear it. Stop hidden display work and release subscriptions/artwork through existing lifetime owners.
- Retire the draft on `resyncing` or replacement `current-state`, even for the same player GUID: ephemeral dispatch state is not recoverable from an application snapshot. A server confirmation temporarily superseding the local dialog cannot count as salvage approval. Use `dialogOwner.bindLocal(salvage)` and release that binding at character-owner teardown.
- HUD additions are serialized through the draft owner. Do not let a second pending addition invalidate and lose the first; retain proposed identities in user order and evaluate the accumulated proposal. During confirmation/submission, refuse additions with a neutral notice rather than changing the reviewed batch. Discovery replies can only open/modify the originating pending request; an explicit close invalidates even a not-yet-visible opening request.
- `SalvageOperationsResult` is optional and grouped by skill, lacks a request identity, and can describe partial processing. Decode it fully and produce existing Salvaging-category chat; do not correlate it to close/clear a window or unlock a pending batch. Inventory remains authoritative. Local preflight rejection is atomic; the server can still process a subset after dispatch.

## Phased implementation

### Phase 1 — shared semantics and guarded contracts

- [x] Preserve public/appraised workmanship separately and migrate affected display consumers. Add candidate pending-details behavior and explicit Examine guidance before wiring submission. Verify appraisal-then-public-recreation ordering as well as public-then-appraisal.
- [x] Add the shared Ust constant/predicate, discovery, 72-material predicate, candidate reasons, batch evaluation, and review comparison value in world; reuse the predictor and correct skill-profile selection against ACE. Treat h3d's multiple-material restriction as queue policy.
- [x] Consolidate TUI tool/candidate/profile assembly and remove superseded paths. Preserve TUI presentation; no runtime-asset tests or TUI execution.
- [x] Add core query/submit requests and correlated outcomes, modeled after guarded item use. Integrate busy/inventory admission without arming a salvage completion tracker. Make the existing raw salvage command use shared validation so older callers do not retain a separate unchecked semantic path; their existing no-modal policy remains theirs.
- [x] Extend semantic candidate facts and snapshot/delta salvage context in world, core publication, `client-entity-mirror.ts`, and all fixture constructors. Preserve snapshot/delta parity; test profile and option changes without item-property messages. Prepare the shared Ust predicate now; introduce the new use-capability variant together with its activation consumers in Phase 2 so there is no interim generic server-use path for that new variant.
- [x] Declare `client-salvage-contract.ts` now, alongside Rust request/result types, so Phase 1 compiles independently. Add `preview_client_salvage` / `submit_client_salvage` to `ClientHostCommand`, `CLIENT_COMMAND_NAMES`, host dispatch, `host-transport.ts` command/event lists, `client_projection.rs`, `protocol.rs` event mapping, and session invoke/listen/event unions. Use `client-salvage-preview` / `client-salvage-result` for correlated replies. Both command enqueue failures and later semantic rejections must release frontend pending state.
- [x] Test exact-tool versus other tinkering tools, nested inventory discovery, pending facts, retained/equipped/traded/non-owned items, full/partial bags, mixed-material option, duplicate/empty batches, stack changes, and changed tool/skills/character at submission. Reuse predictor tests and runtime constants.

Acceptance: world/core/host tests and compilation pass; preview and submission use one evaluator; a changed reviewed batch sends no salvage action; one accepted submit sends exactly one action with reviewed order; a missing Ust returns the agreed refusal.

### Steering checkpoint

Re-walk both entry points through real projection/host/session contracts. Confirm that Phase 2's Ust activation wiring covers inventory, selected Interact, and bound activation; item facts update with trade/ownership while context carries profile/options; and guarded outcomes survive generic busy rejection paths. Reassess scope only if source evidence requires a materially different UX or protocol design. Keep the remaining phases aligned with the same contracts; record course corrections here.

### Phase 2 — frontend owner and cohesive interaction

- [x] Add `client-salvage-state.ts`, `ClientSalvageWindow.svelte`, and its lazy resource-owning `ClientSalvagePanel.svelte` over Phase 1's contract; own pending request identity, pending opening, accumulated additions, preview correlation, confirmation, submission, and teardown. Bind/unbind the owner through existing `ClientDialogs`.
- [x] Wire the owner in `ClientApp.svelte`, compose the window in `ClientGameplayView.svelte`, and introduce `salvage-tool` atomically across world use classification, strict TS schema, `client-item-interactions.ts`, `client-action-item.ts`, and `client-selected-entity-tracking.ts`. Inject one local activation callback for both ordinary and bound Ust use. Update constructor fixtures with the same cutover; no temporary optional handler or generic-use fallback.
- [x] Extend `ClientSelectedEntityHud.svelte`'s existing eligible-action collection with Salvage, preserving direct/menu rules. Add an authored SVG through `ClientHudIcon.svelte` for both action and window, following the existing icon system.
- [x] Pass the session-owned salvage owner through `ClientGameplayView` to `ClientActionBars.svelte`, which actually constructs `ClientItemDrag`; add its narrow target interface there. Handle target hit-testing, highlight, and release before ordinary inventory/viewport fallback. Reject vendor-offer and action-binding sources; only carried inventory gestures can add. Keep original cells and ordinary activation intact. Reuse item artwork and inspect actions.
- [x] Extend `CLIENT_UI_DEFAULTS`, `createClientHudLayout`, and the HUD placement schema with `salvage`; verify per-entry Electron settings read/default composition retains every older placement. Use `ClientHudWindow visible` and `focusRevision` to retain lazy content and raise an already-open window; do not create mount-once flags. The owner clears the draft on close even though window content is retained. Hidden sampling stops and transient questions dismiss. No settings-file version migration.
- [x] Test opening/raising, no-tool refusal without draft mutation, rapid ordered additions, pending appraisal, duplicate/empty inputs, queue order/removal/Clear, single-material restriction and option transitions, stack wording, invalidated approval, stale responses, explicit closure, resync/snapshot replacement, portal/logout, and selected-HUD eligibility without an Ust. Cover both inventory and action-bar Ust activation and selected Interact availability.

Acceptance: both entry points and dragging reach one queue; confirmation submits only its reviewed batch; closing/reopening cannot be affected by old replies; saved placement and keyboard policy follow existing behavior. Browser fixture proves each interaction without starting the interactive client.

### Phase 3 — actual result feedback and integration verification

- [x] Enable `SalvageOperationsResult` opcode/message decoding in protocol, preserving the rejected-GUID list and all wire fields. Verify ACE layout against retail unpacking. Add synthetic valid/truncated/multiple-row/rejected-list cases and deterministic round trips where supported.
- [x] Register the event in both unpack and pack dispatch in `messages/game_event.rs`, exports in the inventory message module, and exhaustive message match consumers. No transport/session changes are needed: this uses the existing game-event envelope. Reject malformed list lengths through existing deterministic parser conventions.
- [x] Handle it in core `client/messages.rs` using existing Salvaging-category chat publication, including rejected-item feedback and skill/augmentation details where present. No extra host result-event family is needed if chat already carries all displayed information.
- [x] Add `client-salvage-fixture.ts` using the real session's synthetic request/reply path in `ClientHudHarness.svelte`, modeled after `client-vendor-fixture.ts`. Update that harness's `ClientItemInteractions` constructor and gameplay props as well as production consumers. Add a focused scripted probe following `scripts/client-vendor-probe.mjs`: HUD → discovery → queued item; inventory/selected/action-bar Ust activation without generic Use; drops/removal/inspection; pending appraisal; cancellation/stale approval; enqueue success before dispatch result does not clear the draft; one submit; failure retains draft; dispatched clears only submitted draft; late/absent/grouped server result messages do not control draft lifetime.
- [x] Run affected Rust tests, formatting, and clippy with warnings denied. In h3d use manifest scripts: `npm run check`, `npm run test:ts -- <affected tests>`, appropriate lint/format checks, and `npm run harness:browser -- <salvage fixture options added by this phase>`. Do not invent an existing salvage harness flag; add and document its invocation with the fixture.

Acceptance: server feedback reaches chat; inventory remains driven by authoritative updates; absent result packets cannot stall UI; focused browser assertions pass. Report any unavailable live verification precisely rather than treating fixtures as live-server evidence.

### Phase 4 — cleanup and user handoff

- [x] Remove superseded TUI/shared helpers, duplicate raw-property logic, unused event variants, and stale vocabulary. Update active architecture docs only where ownership/contracts changed.
- [x] Review every new field for a named consumer and every abstraction for an actual second responsibility/consumer. Keep common chrome/style reuse narrow; extract queue removal layout only if the vendor and salvage implementations demonstrate real shared behavior, migrating both together.
- [x] Review final diff and checks, update phase status/evidence/course corrections, and provide user visual acceptance steps without performing visual acceptance.

Acceptance: no parallel salvage rule implementations; no vestigial contracts or diagnostics; all required automated checks pass or have a precise evidenced blocker; remaining visual acceptance is explicitly handed to the user.

## Risks, concessions, and size

| Risk | Mitigation / accepted limit |
| --- | --- |
| Duplicating ownership/trade/profile assembly | One shared evaluator and projection; cut over touched TUI paths rather than copying them |
| Confusing public averages with raw integer workmanship | Separate public average from appraised total/count; migrate consumers and block previews awaiting details; no synthetic total or silent item omission |
| Skills/options change without candidate-property updates | Compare world-produced salvage context during existing snapshot/delta publication; explicitly publish after character-option changes |
| Original best-trained helper differed from ACE's highest-then-trained rule | Correct profile assembly with a regression case where the highest untrained skill exceeds a trained one |
| Generic command admission returns without a correlated outcome | Guarded-submit handler owns its rejection result, as guarded item use does; test busy and pending equipment paths |
| Preview differs from a customized server | Label estimated output; use authoritative inventory and actual result chat; never promise exact output or output capacity |
| Approval races with inventory or skill changes | World-produced review value, fresh comparison before dispatch, and no automatic retry |
| Results are suppressed, partial, or unrelated to the open draft | No completion barrier and no result-driven queue mutation |
| Existing settings/fixtures require new projection fields | Update producers and schemas together; follow current default/recovery mechanisms, not compatibility aliases |
| Excessive feature infrastructure | Reuse current predictor and transport, introduce one focused core module and one frontend owner/window, and avoid a generic transaction/queue framework |

Expected size: a moderate cross-layer change, with most new code in the frontend owner/window and focused Rust contracts/tests; protocol decoding and host wiring should remain small. Final footprint is approximately 1,800 net production text lines (including comments, excluding unit tests, harness, fixtures, and documentation). The shared provenance/normalization correction, guarded core API, explicit bridge contracts, and window/draft lifecycle account for this growth; no general transaction or queue framework was added. Server-side atomicity, inventory-space guarantees, and recoverable batch completion are expressly not provided by this protocol.

## Definition of done

- [x] Both accepted entry points and drag/drop work with no Add selected control.
- [x] Missing Ust feedback is exact; the HUD action remains discoverable without a tool.
- [x] Eligibility, prediction, and pre-dispatch evaluation have shared Rust ownership.
- [x] Whole stacks, pending appraisal, public-average/raw-total separation, partial material bags, multiple-material preference, and output bag boundaries are represented honestly.
- [x] Relevant changes invalidate approval; stale replies cannot affect replacement drafts.
- [x] Dispatch is distinct from server success; no duplicate automatic submit/retry or optional-result wait.
- [x] Protocol, Rust behavior, TS contracts/state, and browser interactions have focused automated evidence; lint warnings are treated as errors.
- [x] User receives visual acceptance steps and exact verification limits; no interactive TUI or unsolicited visual acceptance was performed.

## Open questions and decisions

No implementation decision remains blocked. Implemented policies: use the existing confirmation modal; honor the existing multiple-material character option; retain drafts when raising/reusing an open window; clear on explicit close or portal entry; keep the window open after dispatch for another batch. Visual layout and interaction feel are ready for the user's acceptance pass.

Source dry run resolved the original open checks: the retail/ACE valid-material sets match (72); appraisal merges supply normalized raw evidence; current publication covers item/storage/trade changes but needs a salvage-context replacement for profile/preference dependencies. Both activation paths, command enqueue versus correlated dispatch, drag-owner construction, settings recovery, protocol registration, and browser-fixture composition are now explicitly assigned to phases above.

Course corrections from the source dry run: add the workmanship-provenance prerequisite and explicit pending-details UX; correct skill selection; keep material preference in frontend queue policy; declare TS contracts in Phase 1; add context invalidation, action-bar/selected-tracking consumers, actual drag construction wiring, lazy-window visibility/focus behavior, and resync retirement. These designs are now implemented and validated by the evidence below; visual acceptance remains with the user.


## Execution evidence and handoff

All implementation phases, the steering checkpoint, and cleanup are complete. The ownership review
traced world normalization → correlated core evaluation/dispatch → host serialization → session
schemas → draft/confirmation → window and drag consumers, including closure, resync, stale replies,
rejected refreshes, and equipment admission. The resulting design is ready within that reviewed
scope. The TUI consumes existing shared semantic records rather than adding salvage methods to its
generic world context. Globally unique request identities retire stale work without a redundant
draft-generation counter.

Verification on 2026-10-24:

- `cargo test -p holtburger-world -p holtburger-core -p holtburger-cli -p holtburger-3d-host -p holtburger-protocol --lib --quiet`: **2,699 passed**, three existing world tests ignored (world 981, core 718, protocol 300, CLI 321, host 379).
- `npm run test:ts -- --maxWorkers=2`: **3,451 passed across 389 files**. The initial unconstrained run timed out in a renderer differential test; that file passed alone and the complete bounded-worker run passed.
- `npm run check`: Svelte, app/node/test/Electron TypeScript checks passed.
- `npm run lint`: ESLint, Knip, and host clippy passed. `cargo clippy -p holtburger-world -p holtburger-core -p holtburger-cli -p holtburger-3d-host -p holtburger-protocol --all-targets -- -D warnings` also passed.
- `npm run format:check`, `cargo fmt --all --check`, and whitespace checks passed.
- `npm run build`: production Vite build passed.
- `npm run harness:browser -- --client-salvage --brief`: **passed**, with no page errors. Exercised HUD entry, missing-tool feedback, ordinary and bound Ust activation without generic Use, actual pointer drag, confirmation, enqueue-versus-dispatch distinction, rejection retention, dispatch clearing, appraisal marker, right-click inspection, removal, and closure. Evidence uses synthetic authority replies through the production session/HUD; it does not claim live-server verification.

The browser probe exposed a stale embedded baseline field after the profile rename. The field is
now corrected throughout the Svelte fixture, and the probe waits for an accepted session snapshot
before emitting a replacement baseline. The Rust/TS wire fixture separately checks real Rust
serialization and browser schema agreement. Rejected estimate refreshes now invalidate the old
quote; they cannot leave a previously ready estimate eligible for approval.

### User visual acceptance

- [ ] Use an Ust and check the empty window, inventory placement, resize behavior, and retained geometry.
- [ ] Select a candidate and choose Salvage in the existing HUD action/menu; check that it joins the open draft.
- [ ] Drag items, inspect a marked `?` source with right-click/Examine, remove entries, and Clear.
- [ ] Review material, units, and workmanship per output bag; cancel confirmation and verify the draft remains.
- [ ] Check drag feedback and confirmation feel; close/reopen and verify the draft clears while placement remains.

No interactive TUI, visual acceptance, git staging, or commit was performed by the agent.
