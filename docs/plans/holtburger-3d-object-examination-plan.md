# 3D object examination implementation plan

Preview architecture follow-up: [Isolated creature preview renderer implementation plan](holtburger-3d-isolated-preview-renderer-plan.md)
owns the selected dedicated-WebGL2-context cutover, visual hooks/particles, main-canvas performance
gates, and remaining preview verification. It supersedes the shared-context and pose-only preview
decisions below; the existing implementation evidence is retained as the starting point.

Status: Phases 1-7 and 9 are complete and verified. The selected Phase 8 equipment- and
creature-enchantment slice is complete while the remaining fast-follow candidates stay deferred.
Phases 10-14 are implemented. Phase 15 verification, profiling, and handoff remain active.

Scope extension (2026-09-17): interactive creature model previews are implemented through the
first production slice described in Phases 10–15 below. The preview supports live idle animation,
yaw rotation, and panel-driven resizing; a static portrait is not an intermediate product milestone.

## Goal and boundaries

Add explicit object examination to `holtburger-3d`: pressing the configured Examine action (`E`
by default) or clicking the selected-entity Examine button requests authoritative appraisal data,
then opens one draggable and resizable inspection window after the matching response arrives.
Items and creatures receive separate shared data shapes and separate frontend presentations. The
TUI and 3D client consume the same world-populated inspection facts rather than maintaining
independent appraisal interpretations.

In scope:

- Examination of any selected entity represented by the shared world state, including world,
  inventory, equipment, and accessible world-container entities.
- Existing `IdentifyObject` request and `IdentifyObjectResponse` protocol behavior.
- Successful, rejected, and missing-target results with explicit frontend feedback.
- One latest-request inspection window, independent of later entity selection.
- Shared item/creature inspection semantics in `holtburger-world`.
- TUI migration to the shared populated inspection contract.
- Item artwork, spell-reference names, and every fact admitted into the first-slice shared model.
- An evidence-driven fast follow for appraisal facts that the current TUI model drops.
- Focused Rust, TypeScript, Svelte, sidecar-contract, and browser-harness verification.
- An interactive creature model viewport within the existing inspection window (Phases 10–15).

Out of scope:

- Multiple simultaneous inspection windows, window stacking/focus management, or pinned history.
- Vendor browsing UI in `holtburger-3d`; existing TUI vendor inspection must continue to work.
- Automatic refresh of an open snapshot after unrelated entity property changes.
- A raw property/debug dump as a substitute for semantic inspection fields.
- Reimplementing ACE appraisal skill checks, retries, timers, or server acceptance locally.
- Pixel-identical retail layout, retail's internal UI architecture, or a universal popup framework.
- Persisting window geometry or adding keybinding settings UI.
- Running the interactive TUI or changing the retail decompile.

## Ground truth and existing owners

Line numbers are investigation anchors and must be rechecked against current source during
implementation. Existing ACE and ACViewer submodule modifications are unrelated and must remain
untouched.

### Server and retail behavior

- `ACE/Source/ACE.Server/WorldObjects/Player.cs:248-345` establishes `E` as appraisal, lookup
  across all player-visible locations, repeated-success behavior, the five-second failed-appraisal
  throttle, creature/person skill checks, deception, item appraisal resistance, and the successful
  or unsuccessful `IdentifyObjectResponse`.
- `ACE/Source/ACE.Server/Network/Structure/AppraiseInfo.cs` is the server-side source of truth for
  which properties, spell entries, armor/creature/weapon/hook profiles, enchantment masks, and
  armor levels are placed in an appraisal response. Its `NPCLooksLikeObject` handling is a required
  classification edge case: ACE communicates the item/object presentation by suppressing the
  creature profile, while a player GUID still requires creature presentation.
- `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventIdentifyObjectResponse.cs` proves that an
  unresolved GUID receives an empty unsuccessful appraisal and that a known object can also return
  an unsuccessful populated profile.
- `acclient-eor-source/acclient.c:222815` and `:224950` establish distinct creature and item examine
  presentations. Use retail behavior as evidence for grouping and specialized facts, not as an
  architecture to reproduce.

### Shared protocol, world, and core

- `crates/holtburger-protocol/src/messages/object/events.rs` already decodes and encodes the full
  `IdentifyObjectResponseEventData` envelope. Do not add a parallel protocol representation.
- `crates/holtburger-core/src/client/commands.rs` already maps `ClientCommand::Identify(Guid)` to
  `GameAction::IdentifyObject`. Keep this command and protocol vocabulary; frontend APIs may use
  the user-facing term “examine.”
- `crates/holtburger-world/src/handlers/inventory.rs:174-195` currently merges successful responses
  into an entity or vendor item and discards unsuccessful/missing outcomes. This is the primary
  failure-semantics gap.
- `crates/holtburger-world/src/identify.rs` owns lossless response merging into authoritative world
  records. Inspection construction must occur only after that merge succeeds.
- `crates/holtburger-world/src/inspect.rs` currently adapts entities/vendor items to property/profile
  access. `crates/holtburger-world/src/assessment.rs` derives the current flat assessment. These
  files are one semantic subsystem and should be consolidated if the resulting module is smaller
  and clearer.
- `crates/holtburger-core/src/client/mod.rs:945-954` currently publishes identified entities and
  republishes presentation/selection facts. Preserve those effects; examination delivery is an
  additional cold semantic result, not a replacement for entity mutation publication.
- `crates/holtburger-core/src/client/entity_facts.rs` publishes reconstructible semantic entity
  state. Inspection snapshots do not belong in that baseline because they are explicit request
  results and are not maintained after publication.

### TUI and 3D frontend patterns

- `apps/holtburger-cli/src/pages/game/domains/object_interaction.rs:40-48` is the current TUI request
  path. `apps/holtburger-cli/src/pages/game/panels/dashboard/assess.rs` is useful presentation
  inspiration but mixes item/creature fields and contains incomplete derivations.
- `apps/holtburger-3d/src/client/ClientSelectedEntityHud.svelte:101-108` contains the disabled
  Examine control to activate.
- `apps/holtburger-3d/src/client/ClientHudWindow.svelte` owns viewport-constrained drag, border
  resize, and close behavior. Reuse it rather than creating another floating-window primitive.
- `apps/holtburger-3d/src/client/ClientWorldContainerWindow.svelte` demonstrates an independently
  retained popup composed around `ClientHudWindow`.
- `apps/holtburger-3d/src/client/client-spells.ts` demonstrates a cold request/result consumer and
  access to shared spell references. Object examination needs a smaller latest-target owner, not a
  copy of spell context invalidation.
- `apps/holtburger-3d/src/lib/input/input-contract.ts`, `input-defaults.ts`, and
  `client/ClientApp.svelte` own configurable gameplay shortcuts and keyboard arbitration. Add a
  semantic action; never compare directly against the literal `e` in the handler.
- `apps/holtburger-3d/src/harness/browser/ClientHudHarness.svelte` and
  `scripts/browser-harness.mjs --client-hud` are the canonical asset-free browser verification
  surface.

## Constraints and invariants

1. **One authoritative derivation.** A successful response is merged into the world record, then
   one immutable `ObjectInspection` snapshot is populated from that merged state. Core, the TUI,
   the host, and h3d must not independently re-derive domain facts from raw properties.
2. **Directional ownership.** Protocol decodes wire facts; world owns interpretation; core publishes
   the cold result; the host narrows transport; each frontend owns formatting and window policy.
3. **No raw world record on the browser wire.** Do not serialize `Entity`, `WorldObjectProperties`,
   or protocol appraisal profiles to TypeScript.
4. **Discriminated subject shape.** Common facts are common because both presentations consume
   them. Item-only and creature-only facts live in separate variants. Do not recreate a wide
   optional-field bag merely to avoid deciding ownership.
5. **Preserve incomplete information.** Unknown values stay optional/explicit. Missing stamina or
   mana attributes must not become authoritative zero merely because the current TUI did so.
6. **Explicit outcomes.** A failed skill/appraisal result differs from a missing target and from a
   host/transport failure. One failure mode maps to one user-facing message.
7. **Cold event semantics.** Opening examination is user-triggered. While its window remains active,
   h3d may request a fresh authoritative snapshot at a bounded, tunable low-frequency cadence. That
   lifecycle does not belong in renderer cadence, Svelte frame-hot state, entity snapshots, or a
   general world polling loop.
   The model preview has an independent frontend animation/camera lifetime; its frames never
   republish appraisal facts or flow through Svelte reactive state.
8. **Latest request wins locally.** h3d retains one requested GUID. A response for another GUID is
   ignored. The server supplies no request token, so do not invent end-to-end sequence correlation
   without evidence that the accepted concession is insufficient.
9. **Snapshot lifetime.** Once opened, the window describes the received snapshot. Selection change
   or entity despawn does not retarget or silently mutate it. Session/world replacement closes it.
10. **Shared request path.** Button and keyboard activation fan into one frontend action and the
    existing `ClientCommand::Identify` dispatch.
11. **No silent fallback.** Missing spell definitions, icon preparation failures, unknown enum
    values admitted by the shared model, and transport failures remain visible diagnostics.
12. **Retail markers.** Add `RETAIL QUIRK` or `RETAIL DIVERGENCE` only for an intentional observable
    compatibility decision meeting the repository's citation and census requirements. Structural
    choices do not receive markers.

## Data distribution and accepted concessions

- Examination requests are infrequent and window-scoped; optimize for clarity and correctness, not
  throughput, caching, or batching. h3d refreshes the active target at a tunable one-second default.
- One window and one latest request cover the required interaction. An `A -> B -> A` request sequence
  cannot distinguish the first A response from the second because the protocol echoes only the
  target GUID. Both responses describe A, so the first slice accepts either as the latest A result.
- A repeated Examine activation for the same currently pending GUID is locally suppressed. Ready
  windows permit at most one refresh in flight. Transport failures retain the current snapshot and
  retry on the next cadence with one reported warning per outage; appraisal rejection or target
  disappearance closes the window.
- Starting a new request closes the previous open snapshot and waits for new details. This avoids
  presenting old content under an active new request.
- No waiting popup is opened. The selected-entity button exposes pending state/disabled activation,
  and failures use existing notice/toast presentation.
- Players use the creature presentation in the first slice. A player-specific variant is added only
  if the census proves materially different consumed facts that deserve distinct UX.
- First-slice completeness means every fact in the locked shared contract is displayed or has an
  explicit diagnostic. It does not mean every retail examination fact is already modeled.
- An open snapshot is replaced only by a complete server-backed re-examination result; property
  deltas do not patch it locally. Preview renderer state is retained unless renderer-relevant source
  facts change. This prevents the inspector from becoming a second world mirror.
- Existing TUI vendor inspection remains supported. h3d vendor UI remains out of scope.

## North stars

- Fan many request sources into one existing command and many presentations into one shared semantic
  snapshot.
- Reduce dimensions at each boundary: wire profile -> world inspection -> host event -> frontend
  view, never the reverse.
- Prefer subtraction: consolidate `inspect.rs` and `assessment.rs` if doing so removes an adapter
  boundary, and delete the old flat `Assessment` vocabulary after the cutover.
- Preserve lossless facts in the shared model while keeping layout, labels, ordering, and color in
  each frontend.
- Add fields only when the census names their source and at least one real consumer.
- Keep functions small and pure: classification, profile extraction, formatting, and result-state
  transitions should be independently testable.
- Fail loudly at typed boundaries; Zod and serde contracts must reject malformed variants rather
  than treating them as an empty inspection.
- Judge the shared contract against a future full client, not only the present TUI formatting.

## Target architecture

```text
E / Examine button
        |
        v
h3d ObjectInspectionState.examine(selectedGuid)
        |
        v
host examine_client_entity -> ClientCommand::Identify(Guid)
        |
        v
protocol IdentifyObject / IdentifyObjectResponse
        |
        v
world: merge response -> populate ObjectInspection once
        |
        +--> existing EntityIdentified / VendorItemIdentified state publication
        |
        +--> ClientViewEvent::ObjectInspectionResult
                  |
                  +--> TUI assessment presentation
                  |
                  +--> h3d host event -> latest-target owner -> popup
```

The intended shared contract is conceptually:

```rust
pub struct ObjectInspection {
    pub guid: Guid,
    pub name: String,
    pub description: Option<String>,
    pub details: ObjectInspectionDetails,
}

pub enum ObjectInspectionDetails {
    Item(ItemInspection),
    Creature(CreatureInspection),
}

pub enum ObjectInspectionOutcome {
    Ready { inspection: ObjectInspection },
    Rejected,
    Missing,
}

pub struct ObjectInspectionResult {
    pub guid: Guid,
    pub outcome: ObjectInspectionOutcome,
}
```

Exact field placement is locked by Phase 1's census. Avoid duplicating `guid` inside the ready
payload if serde shape and consumers remain clearer without it. Rust types should derive the
comparison/serialization traits their named consumers and focused tests require, no more.

On successful entity/vendor identification, either enrich the existing world event with the
already-populated inspection or emit an adjacent narrow ready event in deterministic order. Choose
the smaller shape after tracing immediate consumers. The non-negotiable invariant is that the
inspection is populated once after merge and is the value forwarded by core; core must not rebuild
it from the cloned entity.

## Phased implementation

Keep each phase compiling. Update this plan's status, decisions, census, verification, and debt as
work proceeds. Routine findings are resolved using the north stars; stop for user direction only
when a finding materially changes scope or UX.

### Phase 1 — Census and lock the shared inspection contract

Deliverables: an evidence table recorded under “Implementation decisions and census” in this plan;
focused temporary diagnostics under `crates/holtburger-debug-harness/` only if static evidence is
insufficient; the final proposed field/variant list before production edits.

- [x] Trace `AppraiseInfo.BuildProfile`, `BuildProperties`, `BuildCreature`, `BuildArmor`,
      `BuildWeapon`, `BuildSpells`, `BuildHookProfile`, and `BuildFlags` to enumerate response facts.
- [x] Trace retail item, creature, and character `SetAppraiseInfo` call trees far enough to classify
      facts by presentation and identify observable special cases. Do not port retail rendering.
- [x] Inventory every decoded protocol field and identify whether current world records preserve it.
- [x] Inventory every current `Assessment` field, its source, its TUI consumer, and known incorrect
      fallback. Specifically audit creature zero defaults, item spell enchantment-mask IDs, damage
      effects, capacity usage, mana lifetime, and creature/item classification.
- [x] Check representative content distribution when local assets are available: ordinary weapon,
      armor, caster, consumable, container, portal/door, hook, ordinary creature, player, and
      `NpcLooksLikeObject`. Record the exact command and sample counts; do not retain asset-dependent
      tests.
- [x] Lock first-slice `common`, `item`, and `creature` fields. For each field name its producer,
      consumer, absence semantics, and whether it is first slice or fast follow.
- [x] Decide whether player inspection deserves a third variant. Default remains creature unless
      evidence names distinct first-slice consumers.
- [x] Decide whether consolidating `assessment.rs` and `inspect.rs` reduces concepts/lines. Prefer
      one `inspection` module and delete stale assessment vocabulary if the cutover is clean.
- [x] Record any protocol decoder gap separately. Do not expand the wire decoder for a field that
      the first slice or fast follow will not consume.

Acceptance:

- Every proposed field has a proven source, named consumer, and explicit absence behavior.
- Item/creature classification covers ACE's profile-suppression contract for `NpcLooksLikeObject`
  and separately enforces the player-GUID invariant.
- The first-slice and fast-follow boundary is concrete enough that later phases do not invent fields.
- No production abstraction has been added merely to facilitate the census.

### Phase 2 — Build the shared semantic model and cut over the TUI

Primary files:

- `crates/holtburger-world/src/assessment.rs`, `inspect.rs`, `lib.rs` (expected consolidation/rename)
- `crates/holtburger-world/src/entity.rs`, `vendor.rs` only where snapshot construction needs access
- `apps/holtburger-cli/src/pages/game/panels/dashboard/assess.rs`
- `apps/holtburger-cli/src/pages/game/panels/context.rs`
- focused world and TUI tests

Tasks:

- [x] Introduce the discriminated shared `ObjectInspection` model established in Phase 1.
- [x] Populate common and variant facts through small pure helpers. Preserve unknowns; replace
      current fabricated creature zeros with optional composite facts where the response omitted
      the attribute block.
- [x] Represent item artwork with the existing shared icon-appearance facts or an equally lossless
      shared primitive; do not duplicate composition policy or encoded pixels.
- [x] Represent item spells so an active-enchantment marker is not confused with the underlying
      spell ID. Keep display-name resolution in frontend/content owners.
- [x] Include current profile facts needed by both frontends. Do not expose raw property maps as an
      escape hatch for an unmodeled retail field.
- [x] Migrate TUI assessment formatting to take `&ObjectInspection`. Separate item and creature
      formatting functions while preserving intentional current output for represented fields.
- [x] Move context-local pending/ready/rejected/missing presentation into TUI view state as narrowly
      as possible; do not add a permanent inspection cache to `GameData` unless more than the active
      context consumes it.
- [x] Preserve vendor-item inspection through the same populator and result shape.
- [x] Delete superseded flat `Assessment` fields, constructors, imports, and vocabulary in the same
      change. Do not leave compatibility aliases.
- [x] Add focused unit tests for each variant, optional creature blocks, item subprofiles,
      classification edges, spell markers, and vendor parity.

Acceptance:

- One world-owned constructor produces the snapshots consumed by both frontends.
- Rust types prevent item-only facts from appearing on a creature and vice versa.
- TUI item, creature, failed, and vendor assessment tests pass without running the TUI.
- No consumer reads raw appraisal properties to recreate a modeled fact.

### Phase 3 — Preserve outcomes and publish the cold result

Primary files:

- `crates/holtburger-world/src/events.rs`, `handlers/inventory.rs`, `identify.rs`
- `crates/holtburger-core/src/client/types.rs`, `client/mod.rs`, `client/commands.rs` only if comments
  or exhaustive matches require updates
- `apps/holtburger-cli/src/pages/game/domains/entity.rs`, `trade_vendor.rs`, and context reducers
- focused world/core/TUI tests

Tasks:

- [x] After a successful response merge, populate exactly one `ObjectInspection` and carry it through
      the world event alongside the existing entity/vendor update.
- [x] Emit `Rejected` when a known target returns `success == false`; emit `Missing` when no entity or
      vendor item can resolve the response GUID. Do not merge failed response properties.
- [x] Preserve the existing `EntityIdentified`/`VendorItemIdentified` effects needed by TUI mirrors,
      entity-facts invalidation, dynamic presentation, scale, and selection-envelope publication.
- [x] Add `ClientViewEvent::ObjectInspectionResult` using the already-populated snapshot.
- [x] Order successful entity mutation publication before its inspection result so existing mirrors
      are current when observers react. Test the order where it is contractually observable.
- [x] Route the TUI context through this result rather than rebuilding from its cloned entity.
- [x] Verify unsolicited/late results are harmless to frontends without suppressing the underlying
      authoritative entity merge.
- [x] Test ready entity, ready vendor item, rejected known target, missing target, and the absence of
      stale property mutation after rejection.

Acceptance:

- Every decoded identify response produces one explicit inspection result.
- Successful world mutation and entity publication remain intact.
- The inspection snapshot is constructed once and forwarded, not recomputed in core or frontends.
- Failure states render explicitly in TUI and do not produce an empty panel.

### Phase 4 — Add the h3d host/session contract

Primary files:

- `apps/holtburger-3d/host/src/client_runtime.rs`
- `apps/holtburger-3d/host/src/client_projection.rs`
- `apps/holtburger-3d/host/src/protocol.rs`
- `apps/holtburger-3d/src/client/client-host-contract.ts`
- `apps/holtburger-3d/src/client/client-lifecycle-session.ts`
- new `apps/holtburger-3d/src/client/client-object-inspection-contract.ts` if colocation improves the
  schema; avoid scattering one contract across multiple files

Tasks:

- [x] Add one client-host command, `examine_client_entity { guid }`, that dispatches the existing
      `ClientCommand::Identify(Guid)`. Keep protocol naming inside Rust and user vocabulary in h3d.
- [x] Project `ObjectInspectionResult` through `ClientHostEvent` and `HostEvent`; continue dropping
      broad `EntityIdentified` records from the browser boundary.
- [x] Define a strict discriminated Zod schema matching serde exactly. Reuse existing schemas for
      icon facts or enums where ownership already exists; do not weaken to `unknown`, `record`, or
      optional catch-alls.
- [x] Add `ClientLifecycleSession.examineEntity(guid)` and a typed `object-inspection-result` event.
- [x] Keep inspection out of `ClientCurrentState`, application replacement snapshots, and the entity
      mirror. Resync/lifecycle events invalidate frontend inspection state instead.
- [x] Add host command-decode, event-projection/serialization, Zod success, and malformed-contract
      tests for item, creature, rejected, and missing variants.

Acceptance:

- The browser receives only the narrow semantic inspection contract.
- One typed command reaches the existing identify dispatch and no parallel network path exists.
- Replacement state contains no stale inspection snapshot.
- Rust host and TypeScript contract tests agree on every variant.

### Steering checkpoint — Dry-run the complete request and reset lifecycle

- [x] Trace one item and one creature end to end: selected GUID -> command -> ACE-shaped response ->
      merge -> shared snapshot -> TUI and host -> TypeScript parse.
- [x] Trace rejection, missing target, send failure, newer target, entity despawn, resync, character
      replacement, and ordinary portal/world-generation changes.
- [x] Confirm the accepted `A -> B -> A` GUID-correlation concession remains safe with the actual
      event ordering. Escalate only if evidence demonstrates a user-visible stale result.
- [x] Review the production line delta. At this point there should be one shared model, one existing
      command path, one result event, and no request queue/cache/context-token subsystem.
- [x] Dry-run Phases 5–7 against the landed contracts and update tasks before UI implementation if
      the census materially changed presentation needs.

Acceptance: no remaining phase relies on an unspecified lifetime, error mapping, or data source.

### Phase 5 — Add the h3d latest-target owner and configurable input

Primary files:

- new `apps/holtburger-3d/src/client/client-object-inspection.ts` and focused test
- `apps/holtburger-3d/src/lib/input/input-contract.ts`, `input-defaults.ts`
- `apps/holtburger-3d/src/client/ClientApp.svelte`
- `apps/holtburger-3d/src/client/ClientWorldView.svelte`
- `apps/holtburger-3d/src/client/ClientSelectedEntityHud.svelte`

Tasks:

- [x] Implement a small session-owned latest-target state with explicit `idle`, `pending`, and
      `ready` presentation. Retain the requested GUID and an open immutable snapshot; do not mirror
      entity properties.
- [x] `examine(guid)` closes any previous ready snapshot, suppresses a duplicate pending request for
      the same GUID, invokes `session.examineEntity`, and reports transport failures once.
- [x] Accept ready/rejected/missing events only for the current requested GUID. Ignore older other-
      target results. Clear pending before publishing failure feedback.
- [x] Close and invalidate on resync, leaving `in-world`, character replacement, session teardown,
      or explicit close. Do not close merely because selection changes or the inspected entity
      despawns.
- [x] Add semantic `examine` to `ClientShortcut` with `E` as the default binding. Resolve through
      `APP_INPUT.shortcut`; respect composition, modifiers encoded by the configured binding,
      keyboard ownership, modal/chat focus, and repeat suppression.
- [x] Fan keyboard and button into one `examineSelectedEntity` function that captures the current
      selection. With no selection, the shortcut performs no command and no noisy notification.
- [x] Map viewport right-click to one correlated hit acquisition that commits selection and examines
      the exact returned GUID; empty space only clears selection and never examines the old target.
- [x] Enable the existing Examine button, expose pending/disabled/accessible labeling, and keep
      interaction/use actions independent.
- [x] Test alternate configured binding, repeat suppression, button/key equivalence, no selection,
      latest target, duplicate pending target, ignored late results, close, and lifecycle resets.

Acceptance:

- Button and configured shortcut issue the same single command for the captured selection.
- No popup opens before a ready response.
- Selection changes do not retarget an in-flight request or an open snapshot.
- Failure and lifecycle paths leave no permanently pending control.

### Phase 6 — Build separate item and creature windows

Primary files:

- new `apps/holtburger-3d/src/client/ClientInspectionWindow.svelte`
- new `ClientItemInspection.svelte`, `ClientCreatureInspection.svelte`
- optional small, pure formatting modules/tests where markup would otherwise contain branching
- `ClientWorldView.svelte`, `client-ui-contract.ts`, `client-ui-defaults.ts`,
  `client-hud-layout.ts`
- existing spell-reference and UI-icon services through their public contracts

Tasks:

- [x] Add one independently retained `inspection` placement/default/minimum size to the client HUD
      layout. Render through `ClientHudWindow` with the inspected name and Examine icon.
- [x] Mount the window only for a ready snapshot. Closing clears frontend inspection state without
      changing selection or sending a server command.
- [x] Use a scrollable content surface. Preserve viewport fitting, drag, resize, and text selection;
      do not copy container measurement policy unless inspection content proves it necessary.
- [x] Item presentation: artwork and name, description, value/burden, stack/uses/capacity, status,
      material/workmanship/tinkering, armor/weapon data, requirements, bonuses/effects, mana/charge,
      use text, spells, and inscription according to the locked contract. Group absent sections out;
      do not display placeholder zeroes.
- [x] Creature presentation: name, description, level/type, vitals, attributes, and every other
      Phase 1 creature fact. Use a layout materially distinct from the item property stream. The
      census did not admit creature protections to the first slice; broader creature appraisal
      coverage remains in Phase 8 rather than being fabricated from highlight masks.
- [x] Resolve item artwork through the existing `UiIconRepository` with a window-owned lease and
      explicit failure rendering. Release it on replacement/close.
- [x] Resolve spell IDs through existing spell references. Preserve order and active-enchantment
      distinction; show explicit unknown/failure labels rather than dropping entries.
- [x] Keep formatting and section order frontend-owned. Shared Rust values remain numeric/semantic;
      do not move CSS labels or color categories into world/core.
- [x] Ensure the inspection window and world-container/system windows can coexist under current DOM
      ordering. Do not add general z-order management unless browser evidence shows the feature is
      unusable without it.
- [x] Add component/pure-format tests for conditional sections, unknown values, long text, overflow,
      spell failures, and item/creature separation.

Acceptance:

- Ready item and creature results open visibly different, complete first-slice presentations.
- The window is draggable, resizable, closable, viewport-contained, and coexists with containers.
- Every populated contract field has a visible consumer or an explicit diagnostic.
- Artwork/spell failures do not hide the inspected identity or remaining facts.

### Phase 7 — Browser verification and visual acceptance gate

Primary files:

- `apps/holtburger-3d/src/harness/browser/ClientHudHarness.svelte`
- focused harness fixtures/helpers
- `apps/holtburger-3d/scripts/browser-harness.mjs`
- `apps/holtburger-3d/README.md` for durable user-facing behavior after verification

Tasks:

- [x] Extend the synthetic lifecycle transport with delayed item, creature, rejected, and missing
      inspection responses using the production host-event schemas.
- [x] Exercise the configured Examine shortcut and HUD button through real browser events.
- [x] Assert no window before response, one window after response, captured-target identity after
      selection change, latest-target filtering, duplicate suppression, failure feedback, close,
      drag, resize, viewport fitting, and lifecycle reset.
- [x] Exercise coexistence with a world-container popup and a system window. Record rather than
      opportunistically solving unrelated window-focus limitations.
- [x] Capture representative item and creature screenshots at a declared viewport/theme. Check long
      content scrolling and the smallest supported viewport.
- [x] Present screenshots and a concise visual checklist to the user. Visual acceptance belongs to
      the user; automated geometry/DOM assertions do not claim aesthetic approval.
- [x] Update the README with the final binding, request/snapshot semantics, window behavior, and
      explicit current limitations.

Acceptance:

- `npm run harness:browser -- --client-hud --brief` covers the required behavior without assets or
  an interactive TUI.
- No browser errors, unhandled promise rejections, stale windows, or clipped unreachable controls.
- User has an explicit item/creature visual acceptance opportunity.

### Phase 8 — Fast follow: close proven appraisal coverage gaps

This phase begins only after the first slice is behaviorally complete and the Phase 1 census has a
ranked gap list. It expands the same shared variants and views; it must not introduce a second
“advanced” inspector or raw-properties fallback.

Expected candidates, subject to census evidence:

- [ ] Hook profile facts and hooked-item semantics.
- [ ] Armor levels by body region and retail-relevant armor/enchantment presentation.
- [ ] Creature buffs and omitted creature/person fields.
- [ ] Item ratings, equipment sets, activation/usage requirements, level progression, lockpick
      appraisal, rare/craftsman facts, boost/healing-kit/mana-stone specializations, and portal/house
      descriptions used by retail.
- [x] Enchantment highlight/color semantics for currently presented equipment stats. The shared
      `EnchantedValue<T>` carries the effective value, authoritative polarity, and an unbuffed value
      only where the appraisal exposes enough data to prove it. h3d colorizes effective values and
      shows proven bases parenthetically; the TUI reads the effective member from the same composite
      while retaining its existing compact palette. ACE producers:
      `ArmorMaskHelper`, `WeaponMaskHelper`, and `ResistMaskHelper`. Retail consumers:
      `ItemExamineUI::Appraisal_ShowWeaponAndArmorData`, `Appraisal_ShowDefenseModData`, and
      `Appraisal_ShowArmorMods` (`acclient.c:220999-221334`, `221556-221785`).
- [ ] Player-specific presentation if the census proves it deserves a third variant.
- [ ] Any protocol fields used by ACE/retail but not currently decoded, implemented with packet
      fixtures and authoritative references.

For each added fact:

- [ ] Cite its ACE producer and retail consumer.
- [ ] Add it at the world-owned semantic layer with explicit absence semantics.
- [ ] Add both TUI and h3d consumers or record why one frontend intentionally omits presentation.
- [ ] Add focused model/serialization/presentation tests.
- [ ] Remove the corresponding gap entry; do not accumulate parallel compatibility notes.

Acceptance:

- Every high-priority gap selected from the census travels through the existing shared pipeline.
- No new raw-property or frontend re-derivation path exists.
- Deferred low-value/specialized cases are explicitly listed with evidence and rationale rather than
  implied complete.

### Phase 9 — Cleanup, documentation, and final quality review

- [x] Sweep obsolete `Assessment`, assess/identify/examine aliases, comments, tests, metrics, and UI
      labels. Preserve layer-appropriate vocabulary: protocol `Identify`, semantic `Inspection`,
      h3d action `Examine`, and TUI user-facing `Assess` where intentional.
- [x] Review imports, module colocation, enum exhaustiveness, comments on new types/fields, and error
      messages. One validation clause must map to one reachable failure mode.
- [x] Review all changed contracts producer-to-consumer and confirm each field has a named consumer.
- [x] Inspect the production nonblank line delta. First-slice production growth should remain near
      500-850 lines; tests/harness may exceed that. If substantially larger, identify duplicate
      adapters/state or justify the earned complexity in this plan.
- [x] Run formatting, relevant Rust unit tests, TypeScript/Svelte tests, strict checks, dead-code
      checks, Clippy with warnings denied, build, and the browser harness.
- [x] Perform a dedicated code-quality review across world -> core -> host -> app and resolve all
      blocking findings. Record remaining concessions and verification here.
- [x] Do not run the interactive TUI. Staging and commit remained deferred until separately
      authorized by the user.

Acceptance: the final code looks like one intentional inspection subsystem shared by two
frontends, not an h3d feature bolted beside the TUI assessment path.

Quality-review result (2026-09-17): the world-to-browser contract remains one directional cold
result, the TUI and h3d consume the same semantic snapshot, and the superseded flat assessment
modules are deleted. The review corrected incomplete wield-requirement coercion, ACE-inconsistent
armor/resistance-cleaving derivation, duplicate imbue presentation, the TUI enchanted-value
cutover, and omitted armor base presentation. Formatting, Rust and TypeScript tests, strict checks,
dead-code checks, Clippy with warnings denied, the production build, and the client HUD browser
harness pass. The interactive TUI was not run; visual acceptance remains user-owned.

The staged raw-line accounting is +2,578 net production, +1,510 net tests/harness, and +1,150 net
documentation. The production bucket is conservative because it includes co-located Rust test
modules. It exceeds the provisional 500-850-line estimate: the estimate did not cover the full
strict browser schema, separate item and creature presentations, icon/spell failure surfaces, or
the complete latest-request/input integration ultimately required by the accepted slice. The
growth is spread across those named layers; review found no parallel inspection model, second
world mirror, duplicated request owner, or unused compatibility adapter to remove.

### Phase 10 — Prove interactive preview composition and idle semantics

This extension can run before the remaining Phase 8 appraisal candidates. Phase 9 remains the
original inspection cleanup; Phase 15 closes the preview work separately. Checked tasks are landed;
unchecked tasks are remaining evidence or hardening work. Scope estimates are planning estimates,
not measured implementation results.

Goal: replace the creature diamond with a live model viewport that can be rotated around yaw and
resized with its panel without changing the creature in the world or the inspection snapshot.

Proposed UX:

- A substantial model area above the scrollable creature details, sized as a stable proportion of
  the inspection panel. Existing window border resize controls both model and detail space.
- Left drag rotates yaw only. Left/right keyboard equivalents provide non-pointer operation; there
  is no user zoom, pitch, reset control, or independent model-area divider.
- Start at a consistent three-quarter view, fitted to the complete idle sequence envelope.
  Resize recomputes an aspect-aware whole-model fit without restarting animation or assets.
- Neutral lighting and a self-contained background. Idle continues while the preview is visible.
  Hidden document/unmounted or zero-sized preview does no draw work; resume does not replay hooks.
- Text appraisal appears immediately on its successful response, even while preview assets load.
  Missing visual data or asset failure leaves readable appraisal and a concise preview status.

Initial exclusions: separately attached weapons/shields, particles, sound, physics scripts,
live combat/emote mirroring, appearance refresh after snapshot capture, multiple preview windows,
item-model previews, and persistent camera/layout preferences. Body part and texture substitutions
(including clothing represented by those substitutions) are included. These exclusions are
proposed scope boundaries, not claims that the renderer cannot support them.

Ground truth and existing owners:

| Concern                    | Source and implication                                                                                                                                                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live appearance            | `crates/holtburger-core/src/client/dynamic_entity_view.rs`: client projection carries setup, effective motion table, appearance, scale, and entity placement frame                                                                                           |
| Explorer placement         | `crates/holtburger-core/src/dynamic_entity_view.rs::DynamicEntityViewSource::from_projection` explicitly selects Resting for Explorer world objects; this does **not** establish that every live client creature uses Resting                                |
| Default idle selection     | `crates/holtburger-world/src/motion/selection.rs::set_default_state` selects default style/substate through the content table; trace its cited ACE `MotionTable.GetObjectSequence` and retail `acclient.c:324230-324400` before changing selection semantics |
| Motion representation      | `crates/holtburger-content/src/motion_sequence.rs`: inspect complete cycle sequences, frame windows, rates and missing-cycle behavior; an idle must not be assumed to consist of one clip                                                                    |
| Visual preparation         | `src/lib/assets/setup-visual-host-source.ts`, `setup-visual-source.ts`, and `src/lib/game/systems/object-visual-template-repository.ts` already handle exact setup substitutions and template leases                                                         |
| Live cache friction        | `src/lib/game/runtime/game-presentation-runtime.ts::#retainSpawnedVisual` currently keys users by GUID; preview ownership must be an independent lease without a fabricated entity GUID                                                                      |
| Isolated drawing precedent | `game-presentation-runtime.ts::installPortalTransitionAssets` and `src/lib/game/renderer/webgl2-renderer.ts::#drawPortalTransitionTunnel` draw an authored setup outside world residency with shared resources                                               |
| Final presentation         | `webgl2-renderer.ts::#presentFlatScene` owns the final framebuffer write and world color grade; any shared-context preview must respect its scheduling/state contract                                                                                        |
| Window behavior            | `src/client/ClientHudWindow.svelte` always supplies border resize handles; `Omit<ClientUiPanel, "resizable">` is intentional for these windows and needs no repair                                                                                           |
| App-local controls         | `src/app/pointer-gesture.ts`, `src/client/ClientWorldView.svelte`, and input arbitration own pointer cancellation and world/HUD routing                                                                                                                      |

App-relative paths in this extension are relative to `apps/holtburger-3d/`.

- [x] Trace actual client appearance and effective-motion-table availability for creature/player
      appraisal. Record capture timing, missing-target behavior, and whether available metadata
      survives despawn independently of a rendered scene node.
- [x] Trace the default idle cycle through existing world/content selectors. Census representative
      humanoid, quadruped, flying, multi-part, and absent-motion cases; record multi-clip cycles,
      partial-part animation, signed rates, and setup fallback needs.
- [ ] Build a synthetic browser composition experiment with moving colored model geometry inside
      the actual inspection window and other overlapping HUD windows. Test both overlap orders,
      translucent panel backgrounds, scrolling, clipping, resizing, and dragging.
- [x] Compare the following concrete routes and record the chosen implementation and evidence:

| Route                                                                                    | Benefit                                   | Required proof / cost                                                                                                                                               |
| ---------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Main-context texture composited into the world canvas behind a DOM opening               | Shares existing GPU resources directly    | A transparent opening also reveals intervening/lower HUD elements; prove correct stacking and ancestor backgrounds without adding a general window compositor       |
| Shared rendering followed by a browser-supported canvas image transfer into a DOM canvas | DOM naturally owns clipping and overlap   | Prove transfer ordering, alpha, no world-frame contamination, and measured copy cost; do not assume a zero-copy path or preservation of a transferred source buffer |
| Dedicated preview canvas/context using shared preparation/drawing code                   | Native DOM stacking and isolated viewport | Separate GPU allocations are unavoidable; bound them to one preview and measure startup/resident cost; do not create another complete world runtime                 |

The selected production route is shared-context offscreen rendering followed by asynchronous
WebGL2 pixel-buffer readback into a DOM-owned 2D canvas. A three-slot PBO/fence ring is polled
without waiting; when all slots are busy the preview drops a frame instead of stalling the world.
The preview is capped at 30 FPS and 512x384 physical pixels. This preserves native DOM overlap,
clipping, and scrolling while sharing decoded setup data, templates, geometry, materials, and
animation assets with the world renderer. It deliberately accepts a bounded GPU-to-CPU-to-canvas
copy; hardware profiling remains required. A dedicated context is not retained as a second backend.

Acceptance: one working composition experiment survives both overlap orders and resize; the idle
contract accounts for full sequences; chosen route and resource cost are recorded. No production
UI claims a static setup placement is an animated idle.

### Phase 11 — Capture visual identity and resolve preview idle

Ownership: world retains existing motion semantics; content owns static table queries; core joins
entity appearance with those semantics where entity-aware resolution is required. The H3D host
adapts that reusable result. Appraisal values continue through the existing shared inspection
contract, with no renderer data added to `holtburger-world::inspection`.

Primary touch points: `crates/holtburger-content/src/motion_sequence.rs`, existing
`crates/holtburger-world/src/motion/` selectors, `crates/holtburger-core/src/client/`,
`host/src/client_runtime.rs`, `host/src/client_projection.rs`, `host/src/protocol.rs`,
`src/client/client-object-inspection.ts`, its transport/schema companions, and focused tests.

- [x] Introduce only the missing reusable idle query over the existing table/sequence types.
      Frontend policy requests default-style idle; Rust selects its authored sequence. Do not
      duplicate motion-table lookup in TypeScript or change the live body's state to obtain it.
- [x] Return a discriminated pose description: authored idle sequence, explicitly unavailable
      idle with an authored setup pose, or unavailable visual. Preserve all sequence entries,
      traversal bounds, direction/rate, and loop semantics needed by the sampler.
- [x] Snapshot setup, ordered substitutions, scale, and the resolved preview pose for the requested
      identity. Choose and document one capture edge after the Phase 10 event-order trace, preferably
      at accepted appraisal; a separate cold preparation request must consume captured facts so
      later despawn cannot retarget it. Never silently mix request-time and response-time facts.
- [x] Keep preview preparation asynchronous and separate from appraisal success. Guard completion
      with the local inspection lifetime; close/new request/session replacement retires that lifetime.
      Preserve the existing server GUID-only correlation concession.
- [x] Limit host transport to validated source facts and resolved animation references; do not
      serialize a world entity, GPU resources, or decoded meshes into the appraisal result.
- [ ] Test multi-clip/default-style selection, absence, snapshot replacement, despawn after capture,
      and Rust/TypeScript contract parity with checked-in synthetic data.

Acceptance: the captured creature can be prepared after world removal; idle selection is shared
and deterministic; the text inspector never waits for graphics; stale completions cannot publish.

### Phase 12 — Add isolated model preparation, playback, and resource ownership

Primary touch points: `src/lib/game/runtime/game-presentation-runtime.ts`,
`game-presentation-owner.ts`, `src/lib/game/systems/object-visual-template-repository.ts`,
`src/lib/game/animation/animation-asset-repository.ts`, existing animation samplers, and a small
new model-preview owner colocated with the runtime. Exact filenames follow the Phase 10 route.

- [x] Generalize the existing visual lease only as far as needed for live entities and the preview.
      Retain geometry, textures, and animations through explicit owners with rollback on failure.
- [x] Prepare only the selected idle sequence's dependencies, using the existing decoders and
      pose samplers. Loading the creature's complete combat motion closure is unnecessary here.
- [x] Advance a local preview cursor over the full idle sequence without dispatching animation
      hooks, sound, root locomotion, scripts, or gameplay commands. Merge partial-part poses with
      authored setup transforms using the same rules as the existing model path.
- [x] Derive a stable envelope from the actual preview pose sequence and scale, including rotation
      fit. Keep camera fit stable during playback and refit the whole envelope after resizing.
- [x] Keep appearance immutable for the inspection lifetime. Camera, animation cursor, and size
      changes do not reacquire the model or rebuild shared templates.
- [ ] Test resource sharing for identical world/preview appearances where the chosen route permits
      it, plus failure rollback, replacement while loading, repeated close, and runtime shutdown.

Acceptance: a preview has no world scene/physics membership; playback is independent of world
actions; every acquired resource has a reachable release path and cannot outlive its device.

### Steering checkpoint — Validate the viewport contract before UI integration

- [x] Recheck Phases 13–15 against the chosen composition route and landed source/lease types.
- [x] Confirm that orbit/resize inputs stay imperative and no new per-frame Svelte event bus exists.
- [x] Review line growth and duplicated draw logic. Extract the actual common setup-drawing work
      with the portal path where useful; retain portal-specific camera, sound, and transition policy.
- [ ] Record concessions or content failures; resolve routine details without waiting for visual
      acceptance. A necessary broad window-manager redesign requires explicit scope review.

### Phase 13 — Render the live viewport

Primary touch points: `src/lib/game/renderer/renderer.ts`, `webgl2-renderer.ts`,
`webgl2-flat-scene-presentation.ts` when sharing the main canvas, render-target helpers, device
composition if a dedicated canvas is selected, and a focused synthetic GPU fixture.

- [x] Add an isolated-model draw input with a prepared visual, sampled pose, camera, lighting, and
      target extent. Keep inspection/window identity outside shader and material contracts.
- [x] Reuse material handling, alpha tests, transparent ordering, part transforms, and filtering.
      Generalize useful portal drawing code without copying its virtual world anchor assumptions.
- [x] Own a bounded color/depth target that reallocates only when physical extent changes. Use
      frontend render-scale policy and explicit CSS-to-buffer conversion, not implicit device DPI.
- [x] Implement the selected composition route, including full clipping/overlap behavior. When using
      the main final compositor, keep preview lighting independent of world fog, grade, portal
      warps and selected-entity outlines; preserve one final framebuffer write.
- [x] Restore renderer state after preview drawing and handle atlas changes, close, and context
      loss through the existing device lifecycle. Context loss requires restart today; do not claim
      seamless restoration or add a new restoration subsystem.
- [ ] Verify moving geometry, transparent materials, resize, overlap, world-frame preservation,
      and allocation/release counts in the browser fixture.

Acceptance: preview frames animate and render at the current size without corrupting world frames,
appearing through other windows, or leaving GPU resources after close.

### Phase 14 — Integrate yaw rotation and responsive inspection layout

Primary touch points: `src/client/ClientCreatureInspection.svelte`, `ClientInspectionWindow.svelte`,
`ClientWorldView.svelte`, `client-object-inspection.ts`, `client-presentation-session.ts`,
`client-tuning.ts`, and a focused preview component/controller.

- [x] Replace the decorative diamond with the preview component and explicit loading/unavailable/
      failure states. Keep the fallback marker only for unavailable/failed presentation. Compose
      creature name, level, and type over the preview's top-left corner as one responsive hero.
- [x] Split creature layout into a panel-proportional model viewport and scrollable facts, respecting
      existing minimum window/viewport bounds. Preserve the item layout and border resize primitive.
- [x] Implement pointer capture and yaw-only pointer/keyboard controls. Scope input to the preview;
      rotation cannot trigger world selection, character movement, window drag, action-cell
      activation, or page scrolling. Cancel gestures on close, blur, and pointer cancel.
- [x] Route camera and cursor state through an imperative controller. Svelte holds only cold display
      states and layout. Put adjustable camera/lighting/size values in the existing tuning owner.
- [x] Observe size and position through the composition seam established in Phase 10: ResizeObserver
      alone cannot detect window movement or scrolling. Publish a coherent extent/clip rectangle
      before drawing when the chosen route requires screen-space synchronization.
- [x] Connect pause/resume and teardown to document/viewport/session lifetime. Re-examining resets
      the view; resizing or moving the current window retains its view and animation phase.

Acceptance: users can resize the window, rotate yaw, and read long details; the whole model remains
fitted as the panel changes, all gestures remain local, and asynchronous replacement cannot
resurrect a closed preview.

### Phase 15 — Automated evidence, cleanup, and handoff

- [ ] Add asset-free browser coverage for delayed loading, missing assets, close/replacement races,
      yaw rotation, responsive window resize, minimum viewport, input ownership, both overlap
      orders, document visibility, and lifecycle teardown. Use the actual production components.
- [ ] Exercise representative local creature appearances as diagnostic evidence, including flying,
      broad/tall, multi-part and player bodies. Record exact content and commands; do not retain
      tests that require untracked runtime assets.
- [ ] Measure preview closed/open/rotating with `npm run harness:browser -- --gpu --profile-renderer`
      and record target dimensions, render scale, hardware, cold-load time, resident allocation
      delta and steady-frame cost. Use existing counters or harness instrumentation before adding
      production metrics. No timing budget is established by the estimates below.
- [ ] Run relevant Rust and TypeScript tests, formatting, strict Svelte/type checks, lint/build,
      and Clippy with warnings denied for affected crates; run the preview GPU/browser fixture and
      inspection regressions. Keep portal regression coverage if its draw path was generalized.
- [ ] Remove experiments and unused variants; review source-to-renderer ownership, release paths,
      diagnostic labels and actual line delta. Update README behavior and this plan's evidence.
- [ ] Hand off automated results and remaining visual concerns. The user performs visual and
      interactive acceptance independently; do not stop implementation awaiting that gate or claim
      automated geometry checks establish aesthetic approval.

Implementation evidence (2026-09-17):

- The shared content census covered 436 motion tables, 18,451 cycles, and 62,210 motion-data
  records. It found multi-clip cycles (up to 11 clips), negative and zero frame rates, and setups
  without usable idle cycles; the landed contract preserves those cases rather than flattening
  them to one positive-rate clip.
- Core captures immutable setup, appearance, scale, and resolved idle facts while the examined
  entity is retained. Appraisal publication remains independent; the browser correlates the later
  preview event to the current inspection identity.
- The runtime shares setup decoding, visual templates, geometry/material residency, and animation
  assets with the world while assigning the preview its own lease. The renderer shares one WebGL2
  context and the extracted isolated-setup draw path with portal presentation.
- The selected 30 FPS path uses a bounded offscreen target and three asynchronous PBO/fence slots.
  It never waits for a fence and drops preview captures under backpressure. Completed pixels are
  row-flipped once into a clamped buffer and published to the DOM canvas.
- The live browser regression for Elaniwood golem WCID 11528 opens, closes, and reopens the same
  preview through the production runtime. Both captures contain rendered geometry (4,159 and 4,183
  non-background pixels at 256x192) and report no WebGL errors. After transparent composition and
  aspect-aware fitting landed, the same gate reports 4,448 and 5,079 non-background pixels with a
  zero-alpha background on both captures. This gate caught and now guards the deleted-VAO failure:
  compiled preview draws are owned by the installed preview generation rather than the durable
  template draw unit whose leased geometry can be released on close.
- Preview yaw now moves a Y-up look-at camera around a centered, upright authored model. Render -Z
  is the authored AC +Y front at zero yaw; focused camera tests prove the camera-right vector
  remains horizontal and every envelope corner fits wide, tall, and square viewports. The camera
  starts from a tight sampled idle envelope, then calibrates against the nontransparent silhouette
  gathered during asynchronous row transfer. WCID 11528 settles at 174/192 pixels (90.6%) high at
  both probed yaw angles without touching an edge or producing a WebGL error.
- Preview materials use the same compiled object draw and sampler catalog as the world; the live
  probe selects the active `anisotropic-2x` frame policy. The DOM canvas now renders at device pixel
  density with at least 1.5x supersampling (bounded to 768x576) before browser downsampling, which
  addresses single-sample/CSS-resolution jaggies without inventing a preview filtering path.
- Automated gates passed: affected Rust suites (including 495 core tests), 311 TypeScript test
  files / 2,505 tests, strict Svelte and TypeScript checks with zero warnings, ESLint, dead-code
  analysis, Clippy with warnings denied, production build, formatting, and the existing client HUD
  browser harness. The latter validates surrounding HUD/input regressions but has no live creature
  asset source, so it is not preview rendering evidence.
- Remaining gates are the synthetic component/composition fixture, broader representative-content
  exercise, hardware transfer profiling, explicit resource-race coverage, and user-owned visual
  and interactive acceptance. These are intentionally left unchecked above.

Preview definition of done: an accepted creature inspection has an independently retained live idle
model with responsive whole-model fit and yaw rotation, correct DOM composition, stable appearance
after despawn, bounded resource lifetime, explicit missing-data behavior, and passing automated evidence. A setup-pose
fallback is permitted only when an idle is unavailable and must not be described as animated idle.

Estimated incremental scope: approximately 12–20 production files plus focused tests/harness,
roughly 800–1,500 net production lines and 400–800 test/harness lines. The earlier 1,200–2,000 total
estimate was provisional and did not account for proving DOM stacking. Re-estimate after Phase 10;
the upper end is driven by sequence playback and composition, not the Svelte controls. These ranges
justify inspection of growth, not a target to fill. No new third-party 3D engine is anticipated.

Principal risks and mitigation:

| Risk                                                        | Planned response                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Main-canvas preview reveals lower HUD windows               | Prove both overlap orders first; select one correct composition route before production integration           |
| Idle contains several clips or differs from setup placement | Reuse shared table semantics and preserve the complete sequence; census before locking the contract           |
| Rotating/animating body clips against viewport              | Fit every preview-envelope corner against the current aspect ratio with a fixed camera elevation              |
| Identical models lose resources when one owner closes       | Explicit independent leases and world/preview coexistence tests                                               |
| Preview scripts affect the world or play audio              | Pose-only sampling with no hook dispatch; no world entity installation                                        |
| Model load or context failure takes down readable appraisal | Independent preview outcome/lifetime with explicit diagnostic; follow existing whole-device failure policy    |
| Scope grows into a general UI compositor or asset browser   | One active creature preview; dedicated-context concession if needed; future consumers do not add fields today |

## Verification matrix

Use package scripts where defined. Exact focused commands may be narrowed during execution, but the
final verification must include:

- `cargo fmt --all --check`
- `cargo test -p holtburger-world -p holtburger-core -p holtburger-cli -p holtburger-3d-host`
- `cargo clippy -p holtburger-world -p holtburger-core -p holtburger-cli -p holtburger-3d-host
--all-targets -- -D warnings`
- From `apps/holtburger-3d`: `npm run format:check`, `npm run check`, `npm run test:ts`,
  `npm run lint`, and `npm run build`
- From `apps/holtburger-3d`: `npm run harness:browser -- --client-hud --brief`
- `git diff --check`

If a relevant command fails because an external prerequisite is absent, record the exact command
and failure. Do not label a capability unavailable without reproducing it. Asset-dependent census
or live-server checks supplement but never replace synthetic contract/browser coverage.

## Risks and mitigations

| Risk                                                               | Mitigation                                                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| The current flat model becomes a permanent cross-frontend contract | Census first; introduce discriminated variants; migrate and delete the flat model in one cutover      |
| Item/creature classification fails for NPC-shaped objects          | Prove classification from ACE flags/properties and include `NpcLooksLikeObject` fixtures              |
| Failed appraisal is confused with missing target                   | Preserve known-target state at world handling and publish distinct outcomes                           |
| TUI and h3d drift after launch                                     | Construct one shared snapshot once; both frontends format that value                                  |
| Core or browser retains stale appraisal state across recovery      | Keep inspection out of reconstructible snapshots; reset the app-local owner on lifecycle/resync edges |
| A late response opens the wrong target                             | Latest requested GUID filtering; capture target at activation; explicit A/B/A concession              |
| Optional server data becomes misleading zeros                      | Use optional composite fields and tests for omitted creature/profile blocks                           |
| Spell enchantment IDs are looked up incorrectly                    | Model the high-bit marker semantically before frontend name resolution                                |
| Popup work expands into window-manager redesign                    | Reuse `ClientHudWindow`; accept DOM-order stacking unless empirical evidence blocks use               |
| “All info” grows into unbounded retail parity                      | Lock first-slice fields in Phase 1; rank fast-follow gaps; document evidence-backed deferrals         |
| Appraisal side effects are overlooked                              | Preserve ACE as server authority; do not suppress requests based on local range/skill guesses         |
| Asset-dependent tests ossify                                       | Use assets for census/diagnosis only; retain synthetic checked-in fixtures for regression             |

## Definition of done

- [ ] `E` by default and the selected-entity Examine button share one configurable action.
- [ ] With a selection, exactly one existing identify command is dispatched; without one, none is.
- [ ] The popup does not appear until a matching ready response arrives.
- [ ] Ready, rejected, missing, and transport failures have distinct tested behavior.
- [ ] One world-populated discriminated snapshot serves TUI and h3d.
- [ ] Item and creature windows are materially different and render every admitted first-slice fact.
- [ ] Selection change/despawn does not retarget the snapshot; new request, close, and lifecycle reset
      follow the documented policy.
- [ ] No raw entity/property map, inspection cache, request queue, or context-token subsystem crosses
      into h3d.
- [ ] Existing entity facts, rendering, selection, inventory, vendor, and TUI assessment behavior
      remain correct under regression tests.
- [ ] The browser harness proves input, delayed response, window manipulation, failure, and reset
      paths; the user receives the item/creature visual acceptance gate.
- [ ] Fast-follow fields selected by the census use the same pipeline, with remaining deferrals
      explicit.
- [ ] Formatting, tests, type checks, lint, dead-code checks, build, Clippy, and diff checks pass.
- [ ] Final code-quality review finds no blocking ownership, contract, or maintainability issues.

## Open questions

For the interactive preview, no user choice blocks investigation. Phases 10–15 define the proposed
interaction and exclusions. Phase 10 must settle DOM composition and idle sequence semantics with
evidence before the production rendering approach is locked. Visual and interactive acceptance
belong to the user and do not block automated implementation/verification handoff.

No user decision blocks Phase 2. Phase 1 retained one latest-request window, closing the old
snapshot when a new examination begins, treating players as creatures initially, and accepting
GUID-only A/B/A correlation. Escalate only if implementation or the browser dry-run provides
concrete evidence that one of those choices materially harms behavior or UX.

## Implementation decisions and census

Populate this section during execution. Record decisions, evidence, course corrections, production
line delta, verification results, and user visual feedback here rather than creating parallel plan
documents.

### Phase 1 result (2026-09-17)

Phase 1 made no production-code changes. The first slice is a typed replacement for everything the
TUI intentionally presents today, with known false derivations removed, plus item artwork needed by
h3d. Retail-only breadth remains a ranked fast follow. This boundary keeps the initial transport and
window work finite without creating a raw-property escape hatch.

#### ACE response production

`AppraiseInfo` establishes these response rules:

- `BuildProperties` copies only enum members marked `AssessmentProperty`, then applies appraisal
  transforms such as effective armor, skill, elemental, defense, mana-conversion, resistance, and
  long-description decoration. Player privacy filters and dynamic allegiance/fellowship values are
  applied here; inspection must consume the response, not reconstruct those values from prior state.
- `BuildSpells` sends no spell book for creatures. For items it can send primary/proc/known spells
  and active item enchantments. Active enchantments set bit 31 on the underlying spell ID.
- `BuildArmor` produces the eight protection modifiers and armor enchantment masks only after a
  successful appraisal. `BuildWeapon` similarly produces weapon facts/masks only on success and
  deliberately omits `WeaponProfile` for casters.
- `BuildCreature` always creates health data, but attributes/vitals, ratings, and armor levels are
  success-gated. Armor levels are sent only for players or non-attackable creatures. Attribute and
  resistance highlight/color masks are independent presentation metadata.
- `NpcLooksLikeObject` is server-local and is not itself serialized as an assessment property.
  Instead, ACE suppresses `CREATURE_PROFILE` while retaining `ItemType::Creature`; 1,448 of the
  local world's 7,831 creature templates use this behavior. Successful classification must
  therefore be: player GUID -> creature-shaped player presentation; otherwise a present creature
  profile -> creature; otherwise item/object, including a creature item type with no profile.
- Hooks recursively replace the appraised profile with the hooked item's facts, add a hook profile,
  and alter the long description. Corpses, portals, storage, slum lords, mana stones, craft tools,
  doors, and chests also receive server-side special-case property shaping.
- A failed known-target appraisal can still carry property tables and a health-only creature
  profile. Phase 3 must not merge or publish those partial facts as a ready inspection.
- Instance-ID properties are not represented in the identify wire flags. ACE reduces allowed
  wielder/activator identity to the two assessment booleans; there is no missing IID-table decoder.

Retail has three implementations, but only two first-slice data shapes. `ItemExamineUI` consumes
value, burden, inscription, tinkering, equipment sets, ratings, weapon/armor, defenses, magic,
special properties, usage/activation/level limits, capacity, locks, mana stones, uses, craftsman,
rare, spells, and descriptions. `CreatureExamineUI` consumes the creature profile, type, level, and
combat ratings. `CharExamineUI` additionally consumes gender, heritage, title, society/faction,
allegiance/fellowship, birth/age, deaths, chess/fishing ranks, enlightenment, ratings, and armor
levels. The latter facts are real but have no first-slice TUI consumer, so players remain the
`Creature` variant for the first slice; a `Player` variant is the highest-priority fast follow.

#### Wire and world preservation inventory

| Decoded response fact                               | Preserved after a successful merge?                                          | Current inspection visibility                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| GUID, flags, success                                | GUID identifies the target; flags drive selective merge; success gates merge | GUID is on `InspectableObject`; flags/success are intentionally outcome/merge concerns      |
| Int, int64, bool, float, string, and DID tables     | Yes, in `WorldObjectProperties` on both `Entity` and `CoreVendorItem`        | Yes for named properties used by `Assessment`; not exposed raw                              |
| Spell book                                          | Yes, raw ordered `u32` values retained                                       | Exposed, but current TUI incorrectly looks up bit-31 active-enchantment values as spell IDs |
| Armor, creature, and weapon profiles                | Yes                                                                          | Exposed by `InspectableObject` and partly consumed                                          |
| Hook profile                                        | Yes                                                                          | Dropped by `InspectableObject` and deferred to fast follow                                  |
| Armor, weapon, and resistance highlight/color masks | Yes                                                                          | Dropped by `InspectableObject`; remain preserved on the world record until fast follow      |
| Armor levels                                        | Yes                                                                          | Dropped by `InspectableObject`; player/non-attackable creature fast follow                  |

The protocol decoder covers every flag emitted by ACE's `BuildFlags`. Its general property storage
drops unknown enum IDs, but all fields selected below have named property enums. No first-slice or
selected fast-follow consumer requires decoder expansion. If a future ACE property lacks an enum,
add that named enum/fixture when its semantic consumer is introduced; do not add a raw property bag.

#### Current `Assessment` audit

Every current field is read by `assess.rs`; none is dead. The problem is shape and truthfulness:

| Current area                  | Source and current consumer                                                                | Finding / locked correction                                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity                      | entity name; `LongDesc` then `ShortDesc`; header/body                                      | Keep common and optional; an absent description remains absent                                                                                                                                                                                                                                             |
| Value, burden, level          | `Value`, `EncumbranceVal`, `Level`; basic lines                                            | `value: u32` fabricates zero on absence; make all three optional                                                                                                                                                                                                                                           |
| Capacity                      | pre-existing maximum capacities plus TUI-local player storage counts                       | Never default missing player usage to zero. First slice carries optional maxima only; current usage is not an appraisal fact and is deferred until a world storage owner can provide it                                                                                                                    |
| Material/tinkering/spellcraft | `MaterialType` + effective workmanship, `NumTimesTinkered`, `ItemSpellcraft`               | Item-only optional composites; material is absent unless both facts decode                                                                                                                                                                                                                                 |
| Item mana                     | `ItemCurMana`, optional max, derived remaining time from `ManaRate`                        | Keep current/max/rate-derived duration separately optional. Zero/negative rate or missing rate means unknown lifetime, not zero                                                                                                                                                                            |
| Status and counts             | bonded, attuned, retained, open, locked, sellable, ivoryable, stack, structure             | Item-only. Booleans without presence-aware accessors currently turn absence into false; use `Option<bool>` wherever absence changes meaning                                                                                                                                                                |
| Armor/weapon/protections      | armor property, profiles, damage helper                                                    | Item-only. Caster weapon speed must be `None`, not fabricated `0`; protection profile remains an optional eight-value composite                                                                                                                                                                            |
| Wield requirements            | four requirement triplets plus `ItemDifficulty`                                            | Item-only and keep typed requirement variants. Incomplete/unknown triplets are absent and diagnostic-worthy, never coerced to skill zero                                                                                                                                                                   |
| Bonuses                       | assessment floats and weapon-profile offense fallback                                      | Item-only. Replace stringly `name`/`is_multiplier` with an enum and typed value basis                                                                                                                                                                                                                      |
| Imbues/effects                | five imbue words plus damage/critical/slayer/attack properties                             | Item-only. Follow ACE's property-presence behavior for `IgnoreArmor`/`AbsorbMagicDamage`; classify armor cleaving from `IgnoreArmor` and resistance cleaving from `ResistanceModifierType`, never the weapon damage type. Remove duplicate labels where an imbue and derived effect describe the same fact |
| Creature                      | `CreatureProfile` and `CreatureType`; vitals/attribute lines                               | Health is required when the profile exists. Attributes, stamina, and mana are one optional composite; delete fabricated zero pairs                                                                                                                                                                         |
| Use/inscription               | `Use`; inscription + optional scribe                                                       | Item-only, optional, preserve long text losslessly                                                                                                                                                                                                                                                         |
| Spells                        | raw appraisal spell book; name lookup in TUI                                               | Model `{ id, active_enchantment }`; clear bit 31 before lookup while preserving the marker                                                                                                                                                                                                                 |
| Classification                | currently inferred from optional creature profile in presentation and `ItemType` in places | Centralize once in world. A successful `ItemType::Creature` response without a creature profile is item/object presentation (`NpcLooksLikeObject`), while player GUIDs remain creature presentation                                                                                                        |

#### Locked first-slice contract

The exact Rust names may be adjusted for idiom during Phase 2, but not the facts or ownership below.
“Absent” always means the UI omits the row or explicitly shows unknown where context requires it;
frontends must never synthesize zero, false, or an empty string.

| Shape / field group                                                                                | Producer                                                                             | Named consumers                                | Absence semantics                                                                        | Slice                                  |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------- |
| `common.guid`, `name`                                                                              | merged target identity/name                                                          | TUI header, h3d title/correlation              | required; construction fails loudly without name                                         | First                                  |
| `common.description`                                                                               | appraised `LongDesc`, then `ShortDesc`                                               | TUI/h3d description                            | no description section                                                                   | First                                  |
| `common.level`                                                                                     | appraised `Level`                                                                    | TUI/h3d basic facts                            | unknown level                                                                            | First                                  |
| `item.artwork`                                                                                     | existing merged icon/appearance facts                                                | h3d item hero, TUI may omit visually           | text inspection remains usable and records artwork diagnostic                            | First                                  |
| `item.value`, `burden`                                                                             | appraised `Value`, `EncumbranceVal`                                                  | TUI/h3d basics                                 | unknown, distinct from zero                                                              | First                                  |
| `item.capacity`                                                                                    | item/container capacity maxima already on target                                     | TUI/h3d capacity                               | each maximum independently optional; usage absent                                        | First                                  |
| `item.material`                                                                                    | `MaterialType` + effective `ItemWorkmanship`                                         | TUI/h3d crafting facts                         | whole composite absent unless both exist                                                 | First                                  |
| `item.tinkering_count`, `spellcraft`                                                               | `NumTimesTinkered`, `ItemSpellcraft`                                                 | TUI/h3d crafting/magic facts                   | absent; explicit zero tinkers may be omitted                                             | First                                  |
| `item.mana`                                                                                        | `ItemCurMana`, `ItemMaxMana`, `ManaRate`                                             | TUI/h3d mana/charge row                        | current required for composite; max and remaining duration optional                      | First                                  |
| `item.status`                                                                                      | bonded, attuned, retained, open, locked, sellable, ivoryable properties              | TUI/h3d status chips                           | each presence-sensitive fact independently optional                                      | First                                  |
| `item.stack`, `uses`                                                                               | stack/max-stack; structure/max-structure                                             | TUI/h3d count rows                             | composite absent without meaningful maximum; current is optional rather than zero-filled | First                                  |
| `item.armor`, `weapon`, `protections`                                                              | appraised armor property and armor/weapon profiles plus direct assessment properties | TUI/h3d equipment sections                     | each composite optional; weapon speed optional for caster/profile omission               | First                                  |
| `item.wield_requirements`                                                                          | four appraised requirement triplets and arcane difficulty                            | TUI/h3d requirement list                       | empty list; malformed named requirement is a diagnostic                                  | First                                  |
| `item.bonuses`                                                                                     | appraised offense/defense/mana/critical/elemental values                             | TUI/h3d bonuses                                | typed empty list; baseline values omitted                                                | First                                  |
| `item.special_properties`                                                                          | imbue words and direct special-property inputs                                       | TUI/h3d effects                                | typed empty list; no inference from property presence alone                              | First                                  |
| `item.use_text`, `inscription`                                                                     | `Use`, `Inscription`, `ScribeName`                                                   | TUI/h3d text sections                          | section absent                                                                           | First                                  |
| `item.spells`                                                                                      | appraisal spell book                                                                 | TUI/h3d spell lists and shared catalog lookup  | empty list; unknown catalog ID remains visible                                           | First                                  |
| `creature.creature_type`                                                                           | appraised `CreatureType`                                                             | TUI/h3d identity line                          | unknown type                                                                             | First                                  |
| `creature.health`                                                                                  | successful `CreatureProfile`                                                         | TUI/h3d vital display                          | profile is required for this variant; invalid construction otherwise                     | First                                  |
| `creature.attributes_and_vitals`                                                                   | optional profile attribute block                                                     | TUI/h3d attributes, stamina, mana              | entire composite absent; never zero-filled                                               | First                                  |
| hook semantics/profile                                                                             | ACE recursive hook appraisal + `HookProfile`                                         | future TUI/h3d hook section                    | optional                                                                                 | Fast follow                            |
| enchantment masks and creature buffs                                                               | profile/mask bitfields                                                               | future semantic highlighting in both frontends | optional, no color claim                                                                 | Fast follow                            |
| armor levels                                                                                       | `ArmorLevels`                                                                        | player/non-attackable creature presentation    | optional                                                                                 | Fast follow                            |
| item ratings/set/activation/usage limits/progression/lock/rare/craftsman/heal-kit/mana-stone facts | named assessment properties consumed by retail item call tree                        | future TUI/h3d specialized sections            | property-specific optional composites                                                    | Fast follow                            |
| creature combat ratings                                                                            | ACE `AddRatings`, retail creature/character UIs                                      | future TUI/h3d ratings section                 | zero/absent ratings omitted                                                              | Fast follow                            |
| player identity/social facts                                                                       | ACE player-filtered properties; retail `CharExamineUI`                               | future distinct player UX in both frontends    | property-specific optional facts                                                         | Fast follow; add `Player` variant then |

The first-slice enum remains `Item(ItemInspection) | Creature(CreatureInspection)`. Player GUIDs use
the creature variant in Phase 2, but the classifier is explicit and tested so the fast-follow
`Player(PlayerInspection)` cutover does not depend on heuristics. `NpcLooksLikeObject` is classified
as item/object despite its creature item type.

#### Content census

`dats/assets.hba` contains 885,043 static DAT/HBA records but no ACE weenie templates, so the
representative semantic census used the existing local ACE world database. Reproducible read-only
query (credentials come from `ace-root/docker.env`):

```sh
mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u "$MYSQL_USER" \
  -p"$MYSQL_PASSWORD" --batch --skip-column-names ace_world --execute '
SELECT type, COUNT(*) FROM weenie
WHERE type IN (2,3,6,7,10,18,19,20,21,35,37,56,57,58)
GROUP BY type ORDER BY type;
SELECT SUM((value & 1) != 0), SUM((value & 2) != 0),
       SUM((value & 32) != 0), SUM((value & 256) != 0),
       SUM((value & 512) != 0), SUM((value & 32768) != 0),
       SUM((value & 65536) != 0), SUM((value & 524288) != 0)
FROM weenie_properties_int WHERE type=1;
SELECT w.type, COUNT(*) FROM weenie w
JOIN weenie_properties_bool b ON b.object_Id=w.class_Id
WHERE b.type=83 AND b.value=1 GROUP BY w.type ORDER BY w.type;'
```

| Representative class                    | Census predicate           | Count |
| --------------------------------------- | -------------------------- | ----: |
| Melee weapons                           | `ItemType & 1`             | 2,949 |
| Armor                                   | `ItemType & 2`             | 1,846 |
| Consumable food                         | `ItemType & 32`            |   422 |
| Missile weapons                         | `ItemType & 256`           | 1,278 |
| Containers                              | `ItemType & 512`           |   760 |
| Casters                                 | `ItemType & 32768`         |   424 |
| Portals                                 | `ItemType & 65536`         | 3,308 |
| Mana stones                             | `ItemType & 524288`        |    15 |
| Creatures                               | `WeenieType = 10`          | 7,831 |
| Doors                                   | `WeenieType = 19`          |   542 |
| Chests                                  | `WeenieType = 20`          |   659 |
| Hooks                                   | `WeenieType = 56`          |     5 |
| Storage                                 | `WeenieType = 57`          |     1 |
| House portals                           | `WeenieType = 58`          |     1 |
| `NpcLooksLikeObject` creature templates | `WeenieType = 10`, bool 83 | 1,448 |

The same boolean appears on one generic and one vendor template, so classification must not assume
it is creature-exclusive. The local shard contains 11 records in the canonical player GUID range;
their authored weenie types are creature/admin, confirming GUID range—not weenie type—is the stable
player discriminator. That count is reproducible with
`SELECT COUNT(*), MIN(weenie_Type), MAX(weenie_Type) FROM ace_shard.biota WHERE id BETWEEN
1342177280 AND 1610612735;`. These counts are evidence only and are not retained as asset/database
tests.

#### Module decision and next-phase constraints

Consolidate `assessment.rs` and `inspect.rs` into one `inspection` module during Phase 2. The current
adapter exists only to feed the assessment constructor, omits preserved profiles/masks, and creates a
second vocabulary without a second owner. The clean cutover is one borrowed internal inspection
source plus the public immutable inspection types/populator; delete `Assessment`,
`InspectableObject`, and stale imports together rather than keeping aliases.

Phase 2 must add fixtures for ordinary item, caster-without-weapon-profile, normal creature,
attribute-less creature profile, player GUID, and `NpcLooksLikeObject`. Hook, armor-level, and mask
facts already remain losslessly stored on the entity/vendor record; do not copy them into the new
snapshot or internal adapter until the fast follow gives each one a named consumer.

### Phases 2-3 result (2026-09-17)

`assessment.rs` and `inspect.rs` were replaced by one `inspection.rs` subsystem. The old flat
`Assessment`/`InspectableObject` vocabulary has no compatibility alias. A small borrowed
`InspectionSource` remains because both the semantic populator and the existing TUI debug view are
real consumers of the same entity/vendor surface; it is not a second public inspection shape.
`EntityIconAppearance::from_properties` now owns icon-composition extraction for both entity facts
and item inspection.

The world merges a successful identify response, emits the existing entity/vendor mutation event,
then emits exactly one ready inspection result. Known failed targets emit `Rejected` without merging
their partial response; unresolved targets emit `Missing`. Core forwards the populated snapshot as
a cold event without adding it to replacement state. The TUI retains only the active context result,
filters late GUIDs, and retires it when the target/context/session lifetime ends.

Verification completed without running the interactive TUI:

- full relevant Rust suites: `holtburger-world` 853 tests, `holtburger-core` 492 tests,
  `holtburger-cli` 353 tests, plus doc tests;
- focused core forwarding regression after the seam audit;
- Clippy for world/core/CLI with all targets and warnings denied;
- `cargo fmt --all` and `git diff --check`.

The quality seam review found and fixed two derived-state lifetime gaps: changing appraisal targets
could retain the prior result, and entity/session retirement could close presentation without
retiring the result. No blocking Phase 2-3 ownership finding remains. The shared model is larger
than the deleted flat assessment because it preserves absence and replaces stringly presentation
facts with typed variants; final production-line accounting remains a Phase 9 obligation.
