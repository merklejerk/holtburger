# 3D give interaction

Status: implemented; automated verification and final code-quality review complete.
Visual/live interactive acceptance belongs to the user and is not an agent
implementation gate. The user requested a final code-quality review and commit.

## Goal and boundaries

Give an owned item to a plausible world recipient by dragging onto that entity or
by selecting the recipient, selecting the item, and pressing `G`.

In scope: carried and equipped sources, whole-stack quantity, coarse local
recipient rejection, previous-selection tracking, selection-free viewport picking,
existing server refusal feedback, and regression coverage for pickup/drop.

Out of scope: partial-quantity dialogs, player trade windows, item-specific NPC
acceptance prediction, non-creature recipients, hostile-creature turn-ins, queues,
automatic retries, optimistic inventory mutation, new completion locks, and TUI
interaction migration. Action-bar binding drags continue to edit bindings.

## Ground truth and existing owners

- `ACE/Source/ACE.Server/WorldObjects/Player_Inventory.cs:3190`:
  `HandleActionGiveObjectRequest` takes recipient, source and amount; accepts
  inventory/equipped sources and performs server-owned approach.
- The same file's `GiveObjectToPlayer`, `GiveObjectToNPC`, and `RemoveItemForGive`
  own acceptance, quantity consumption, removal and dequipping. Attunement blocks
  player transfers but is not a blanket prohibition on NPC turn-ins. NPC emote
  turn-ins may consume one item despite a whole-stack request.
- `crates/holtburger-protocol/src/messages/inventory/actions.rs`:
  `GiveObjectRequestActionData` already serializes target GUID, item GUID and
  signed 32-bit amount. No protocol extension is needed.
- `crates/holtburger-core/src/client/commands.rs`: existing
  `GiveObjectRequest` wire dispatch and protected-operation gates.
- `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/tab.rs` and
  `classification.rs`: TUI offers give for players, NPCs and vendors; NPC/vendor
  classification uses public creature and non-attackable facts. Reuse the idea,
  not TUI presentation types or quantity calculation from the selected target.
- `crates/holtburger-world/src/interaction.rs`, `entity_facts.rs`: shared
  eligibility and published facts, following the pickup precedent.
- Core `inventory_plan.rs`, `inventory_runtime.rs`: common preview/submission
  evaluator and single-request execution; no new give executor is necessary.
- App `client-entity-selection.ts`, `client-item-interactions.ts`,
  `client-item-drag.ts`, and `client-pointer-selection-controller.ts`: selection,
  action precedence, gestures and asynchronous target acquisition respectively.
- App `client-lifecycle-session.ts`, `client-inventory-contract.ts`, host
  `client_runtime.rs`, `client_projection.rs`: typed submission, preview and
  feedback adapters. `ClientApp.svelte`, `ClientWorldView.svelte`, and
  `ClientActionBars.svelte` compose the owners; `lib/input/input-defaults.ts`
  supplies gameplay bindings.

Line numbers are investigation anchors; verify against current source. Existing
ACE submodule modifications are unrelated and must remain untouched.

## Behavior and design rules

1. World owns a coarse recipient-candidate predicate and publishes its result.
   Admit a known, currently world-present player other than self, or a known
   non-attackable creature, including vendors. Require appropriate world placement
   and exclude stored/owned objects. Do not require the recipient to be in reach:
   ACE owns approach. This authorizes an attempt, not acceptance.
2. Core validates source ownership, distinct source/recipient, current recipient
   eligibility and quantity at submission. Whole-stack quantity comes from the
   source's authoritative stack facts, or one for a known non-stackable item;
   missing required facts must not silently become quantity one. Validate positive
   signed-wire range before constructing the resolved request.
3. The frontend sends intent, not a pre-authorized cached plan. Preview is a hint;
   core re-evaluates on submission. Emit exactly one give request without a
   preliminary unequip, storage reservation or completion-wait owner.
4. `G` always means current selection = source, previous distinct selection =
   recipient. No role reversal, search backward, or persistent remembered NPC.
   Selecting the same identity does not change history. Clearing selection clears
   the pair; removal retires the affected identity, and world exit clears both.
   Pending/resynchronizing authority prevents submission. Current selection
   remains unchanged by give submission or refusal.
5. A real inventory drag continues to select its source once at the threshold.
   Recipient picking must not modify current or previous selection. Giving
   supersedes pending use-with-target acquisition. Ignore keyboard repeats and
   respect existing gameplay focus, modifier and modal rules.
6. Entity picking precedes recipient eligibility: an ineligible entity hit must
   never be filtered out and mistaken for empty ground. Empty means an available
   completed query found no entity through the existing occlusion/refinement path.

| Viewport release outcome | Action |
| --- | --- |
| Eligible entity | Give to that captured identity |
| Ineligible entity | Neutral refusal; no ground fallback |
| Confirmed empty world point | Existing ground drop |
| Unavailable/failed picking | End gesture with feedback; no inventory submission |
| Overlay/outside viewport | Existing cancellation |

Use hover only for recipient highlighting and give/drop hints. Always sample the
release point afresh and correlate its result with the released gesture. Cancel,
replacement gestures, removal and lifecycle reset must invalidate late results.

## Phase 1 — Shared eligibility and give execution

- [x] Add the world recipient predicate and an explicitly attempt-oriented entity
  fact; reuse it in projection and core admission. Do not reconstruct flags in UI.
- [x] Extend inventory target/plan/preview with give semantics. The resolved plan
  carries source, recipient and validated amount; serializers consume that plan.
- [x] Wire the existing native action through inventory submission and carry the
  extended types through host and TypeScript validation without a parallel API.
- [x] Keep existing protected equipment/pack-exchange gates and ordinary action
  feedback. Leave server quest, attunement, capacity, busy and preference checks
  authoritative. Do not broaden all feedback severity rules as part of this work.
- [x] Test candidate eligibility/publication, changed ownership or recipient,
  stack quantity/range, equipped sources and exact outgoing action.

Acceptance: both preview and submission use current shared rules; one admitted
give sends exactly one correctly addressed request with source-derived quantity.

## Phase 2 — Previous selection and `G`

- [x] Keep current/previous identities together under `ClientEntitySelection`;
  update them only at actual selection publication and explicit retirement.
  Separate lifecycle clearing from user selection so clearing cannot create a
  previous identity accidentally. Do not introduce a history service or queue.
- [x] Add a semantic `give` action to `lib/input/input-contract.ts` and its default
  `G` binding to `lib/input/input-defaults.ts`. Resolve it through
  `APP_INPUT.shortcut("give", event)`, like other client actions; no literal key
  checks or fixed modifier guards in the interaction handler that defeat remapping.
  This uses the existing configuration mechanism, without introducing a settings UI.
- [x] Add a frontend interaction entry point that captures the pair, cancels
  target acquisition, validates availability and submits intent.
- [x] Test an alternate configured key/chord: it triggers give, the former default
  does not, and focus/repeat rules still apply. Browser probes should read configured
  bindings rather than enshrine G as an immutable behavior.
- [x] Explain absent/invalid pairs with a neutral notice. Keep repeat presses from
  generating repeated gives; no action when chat or modal input owns the key.
- [x] Test recipient -> item -> G, repeated selection/drag of the same item,
  explicit clear, removed current/previous entities, recovery and world exit.
  Verify use-with-target clicks remain selection/history-neutral.

Acceptance: the configurable give action (G by default) uses exactly the current
item and previous distinct recipient,
without swapping roles, changing selection, or using a retired identity.

## Phase 3 — Drag recipient acquisition

- [x] Tighten the existing selection-free picker contract to distinguish entity,
  empty and unavailable outcomes. Today missing ray/presentation and unavailable
  query results silently return. Complete these paths for the interaction caller
  without treating them as empty or changing ordinary click-selection behavior.
- [x] Audit immediate picker consumers: ordinary selection, hover and
  use-with-target. Propagate failure/cancellation ownership explicitly; avoid
  duplicate notices from both picker and gesture owners.
- [x] Extend the drag state with a released viewport-query stage. Capture source
  and release point, preserve click suppression, then feed resolved give/ground
  intent into existing fresh preview and submission handling.
- [x] Keep a pending query bounded by existing cancellation/lifecycle machinery;
  a new gesture supersedes it. Do not reuse an uncorrelated hovered GUID, retain
  camera coordinates after their valid query lifetime, or add a second picker.
- [x] Provide pending/accepted/refused viewport highlighting using the
  same coarse fact. Preserve overlay exclusion, sorted inventory, bags, equipment
  and action-bar binding semantics.
- [x] Exercise real browser pointers for entity, ineligible entity, empty ground,
  unavailable picking, delayed/superseded results, cancellation and source removal.

Acceptance: a release submits at most once to its resolved destination. Every
failure/cancellation retires the gesture; no failed give becomes a ground drop,
and target acquisition never selects the recipient.

## Cleanup and verification

- [x] Review producers and immediate consumers of each changed contract together;
  sweep stale comments, duplicated recipient predicates and obsolete picker paths.
- [x] Update `docs/inventory.md` and relevant core architecture guidance. Keep
  delivery/attempt semantics explicit; do not advertise guaranteed transfer.
- [x] Review production line growth. Expected additions are one shared predicate,
  an inventory case, a selection pair, and an asynchronous drag stage. New queues,
  caches or orchestration services require reconsidering the design.
- [x] Run focused world/core/host tests, app TypeScript tests, type checks, ESLint,
  dead-code checks, formatting and Clippy with warnings denied as appropriate.
  Run the automated HUD browser probe for changed browser interaction boundaries.
- [x] Finish a code-quality review, record findings and verification here, and
  leave visual/live checks to the user. Do not run the TUI or commit unless asked.

## Risks and accepted concessions

- Coarse eligibility can reject unusual hostile/non-creature turn-in targets.
  This is the accepted first scope; do not infer server emote tables locally.
- Snapshot quantity/ownership may change after preview. Core revalidation and
  authoritative server results handle this; no reservation or retry mechanism.
- Previous selection can be surprising after unrelated selections. Use exactly
  one prior identity, invalidate it explicitly, and explain invalid pairs.
- Picker availability is not a hit test miss. Preserve that distinction through
  the adapter and test it with delayed/failed queries before enabling fallback.
- Existing refusal presentation is not uniformly neutral across every server
  packet family. Reuse current behavior; keep broader feedback work separate.

## Definition of done

- [x] Both triggers share core give admission and the existing wire command.
- [x] Give uses the common configurable input map; remapping is verified.
- [x] Selection/history behavior and give/drop precedence match the rules above.
- [x] No completion lock, optimistic mutation or unintended ground fallback.
- [x] Automated regression checks pass and review findings are resolved/recorded.
- [x] User-owned live checklist is documented, not claimed by synthetic tests:
  player transfer, NPC turn-in, equipped/stack/bag give, refusals, approach,
  G selection sequence, hover feedback and ground-drop regression.

Open questions requiring user input: none for this scope. Whole-stack quantity
and the coarse recipient set are implemented. Live behavior remains subject to
the user-owned acceptance checklist below.


## Implementation decisions and final review

- `give_recipient_candidate` publishes `canReceiveGive` and is reused by core
  admission. The plan stores the exact signed quantity, avoiding an unchecked
  unsigned-to-signed wire cast in the new path. Existing low-level TUI give
  dispatch is unchanged; this feature does not migrate TUI policy.
- Selection retains one current/previous pair. Its existing publication path
  rotates only distinct selections and clears history on null publication;
  authoritative maintenance retires removed prior identities.
- `ClientItemInteractions.giveSelected` owns the configurable shortcut's local
  policy, cancellation and neutral notices. Core still revalidates submission.
- The existing drag owner gained a viewport target variant, not a second gesture
  service. The shared pointer owner resolves it without selection changes.
  Hover permits one pending query; release forces a new sample and then uses the
  existing inventory preview/submission stages. Source ownership loss cancels
  pending gestures; stale replies cannot initiate give or drop.
- Review exposed a second availability seam: exact refinement previously could
  not distinguish missing candidate geometry from a miss. `complete` now carries
  that evidence from geometry refinement to interaction picking. Ordinary click
  selection retains its existing ability to select available geometry; give/drop
  requires complete refinement. A superseding query also completes the prior
  current interaction as unavailable rather than leaving its gesture hanging.
- Give feedback uses the existing viewport outline and dragged artwork. The
  additional drag label was removed at user request; other inventory interactions
  do not use it. No mesh-outline or renderer marker owner was added.
- Final review inspected world eligibility -> fact publication -> mirror, core
  intent/preview -> host dispatch -> native action, selection -> configurable
  input -> give controller, geometry -> pointer acquisition -> drag release, and
  failure/reset/source-removal paths. The neutral server refusal adapter from
  pickup/drop remains unchanged. No blocking findings remain in these seams. The requested pre-commit pass
  rechecked selection history, configurable input, source admission, native wire
  dispatch, and picker/drag completion after removing the drag label. No further
  production changes were needed; live server acceptance remains unverified.
- Final production nonblank line delta: +364, excluding Rust test modules,
  frontend tests and browser harnesses. Most new frontend code belongs to exact
  viewport resolution and its completion paths; no queue, reservation cache,
  completion-wait owner or second picker was introduced.

## Verification record

- `cargo test -p holtburger-core -p holtburger-world --lib --quiet`: 448 core and
  800 world tests passed. The existing network-batch test needs loopback access;
  the sandbox-only attempt failed on socket permission, then the authorized run
  passed. Give coverage includes source quantity, recipient changes/publication,
  equipped sources and decoding the exact outgoing native give request.
- `cargo clippy -p holtburger-world -p holtburger-core -p holtburger-3d-host
  --all-targets -- -D warnings` passed; only Cargo's binrw future-compatibility
  advisory remains.
- `npm run check`, `npm run test:ts` (294 files / 2,370 tests), `npm run lint:ts`,
  `npm run lint:dead`, and `npm run build` passed. Vite reports its existing
  large-chunk advisory. Changed frontend files were formatted with Prettier.
- `npm run harness:browser -- --client-hud --brief` passed, reporting worldGive,
  configuredGiveHotkey and giveFailureNeverDrops. Actual CDP gestures exercise
  give, default-configured hotkey and repeats, empty-ground drop, ineligible and
  unavailable destinations, late cancellation replies, and source removal while
  picking. Existing action-bar and use-target probes also pass. Alternate-key/
  modifier remapping and geometry availability are covered by focused unit tests.
- `cargo fmt --all --check` and `git diff --check` passed.
- Strict browser fixtures were updated for the required new entity fact; an
  inventory-local recipient fixture replaces reliance on an earlier probe's
  entity snapshot. No temporary diagnostic instrumentation is retained.

## User-owned visual/live acceptance

These are not claimed complete by synthetic tests:

- [ ] Give to another player; verify acceptance and refusal feedback.
- [ ] Complete an NPC turn-in, including an attuned item and a stack.
- [ ] Give equipped items and bags; verify authoritative removal/remaining count.
- [ ] Select recipient then item and use the configured give shortcut.
- [ ] Check the viewport outline and approach behavior.
- [ ] Check failed recipient targeting never drops, and empty-ground drop still works.
