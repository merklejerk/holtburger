# h3d vendor trading implementation plan

Status: implementation in visual review. The first user review requested catalog
padding, a currency divider and icons, same-row buy/sell groups, compact right-aligned
actions, a remove overlay, and an inventory-style quantity prompt before adding
stackable purchases. A later review replaced the vendor catalog's square item cells
with grouped rows showing an icon, item name and quoted price. Currency displays
now use icon then amount throughout the panel, with the name in a tooltip.
Catalog prices above the projected balance are red; the currency line shows
signed deltas, colors negative projected balances red, and aligns to the right. Queue
headings read "Buying for" and "Selling for". Updated visual acceptance remains.

The initial plan received a source-level end-to-end walkthrough, including
standalone TUI consumers. Implementation now has semantic, command-boundary,
transport, host/browser-contract, and browser gesture coverage. No live trades
were performed.

## Goal and scope

Implement a vendor HUD window with categorized merchandise, a combined buy/sell
draft, currency previews, and a confirmed sell-then-buy execution flow.

In scope:

- A vendor window participating in the standard HUD layout.
- Scrollable category sections containing item rows with item icon, name, and
  currency icon followed by price. A row selects its offer; the Examine shortcut
  or right click inspects it. Prices exceeding the projected payment balance
  are red.
- One right-aligned horizontal currency line showing every relevant currency as icon then
  amount, including zero balances, and `current → projected (signed delta)`
  balances when a draft exists. Negative projected balances are red; deltas
  retain the normal text color.
  Currency names appear in tooltips and accessible labels.
- A dynamically sized, bounded queue area beneath the currency line, with an
  empty placeholder and separate Buying and Selling groups with distinct borders.
  Each group heading reads "Buying for" or "Selling for", followed by a currency
  icon and total amount.
- Vendor drag or double-click to buy; owned-inventory drag to sell. Queue whole
  source stacks. Merge only compatible stackables, independently on each side.
- Known-invalid sale rejection before queuing, with a useful explanation.
- One Trade button: sell, wait for the sale's terminal `UseDone`, then attempt
  the buy even if ACE rejected some or all sale sources. Skip an empty phase.
  Keep unsold sources queued and report an incomplete sale alongside the buy result.
- Typed vendor state and transaction outcomes through the h3d host boundary.

Out of scope:

- Atomic barter, rollback, automatic retry, or server changes.
- Additional pre-buy balance/stock rechecks, disconnect reconciliation, or a
  recovery subsystem for uncertain transactions.
- Elaborate handling of window closure during a transaction.
- Partial-source-stack selling, physical stack consolidation, or generalized
  shopping-cart infrastructure.
- New TUI UX, running the TUI for diagnostics, or changing the retail decompile.

Implementation was subsequently authorized by the user: execute this plan and
stop for a major blocker/gap or user visual acceptance.

### TUI impact

The TUI keeps its existing vendor UX: separate buy and sell actions, currently
submitting one item ID and quantity per request. The combined sell-then-buy flow
is explicitly requested by a client; adding it to core does not change standalone
commands into combined trades or introduce a TUI draft queue.

The TUI is still an affected consumer of shared code:

- Route its standalone commands through the same corrected completion handling.
- Replace its inline vendor-price calculation with the shared pricing helper.
- Update event consumers and vendor test fixtures as shared contracts require.
- Compile the TUI and run its focused vendor/completion tests. Do not launch the
  interactive TUI for verification.

These are required integration changes, not a TUI workflow redesign. Do not
preserve duplicate pricing or completion implementations for compatibility.

## Ground truth and existing patterns

Paths below are relative to the repository root. Source is authoritative; line
numbers cited in conversation are only navigation hints.

| Source                                                                                                                                                                    | Evidence or implementation precedent                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventApproachVendor.cs`                                                                                               | Flat stock snapshot, quantities, vendor terms, and one purchase currency per vendor.                                        |
| `ACE/Source/ACE.Server/WorldObjects/Player_Commerce.cs`                                                                                                                   | Sale filtering, whole-object removal, pyreal payouts, per-item acknowledgments, and `UseDone`.                              |
| `ACE/Source/ACE.Server/WorldObjects/Vendor.cs`                                                                                                                            | Purchase validation, price rounding, promissory notes, stock refresh, and alternate-currency consumption.                   |
| `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventItemServerSaysContainId.cs`                                                                                      | Sold-item acknowledgment is `InventoryPutObjInContainer(item, vendor)`.                                                     |
| `ACE/Source/ACE.Server/Network/GameEvent/Events/GameEventInventoryServerSaveFailed.cs`                                                                                    | Explicit failure can have `WeenieError.None`.                                                                               |
| `acclient-eor-source/acclient.c`, `VendorItemsUI::OpenVendor`, `ListContainsType`, `UpdateItemsList`                                                                      | Retail category labels, order, composite type masks, and local filtering; approximately lines 233438 onward.                |
| `crates/holtburger-protocol/src/messages/trade/events.rs`                                                                                                                 | Existing complete vendor wire decoding.                                                                                     |
| `crates/holtburger-world/src/vendor.rs`, `state/mutations.rs`                                                                                                             | Separate vendor-offer state and hydration; retains decoded acceptance terms.                                                |
| `crates/holtburger-world/src/context.rs`, `resolve_merge_stack_amount`                                                                                                    | Existing stack compatibility versus physical destination-capacity logic.                                                    |
| `crates/holtburger-core/src/client/{commands,messages,mod,types}.rs`                                                                                                      | Buy/sell dispatch, single active busy operation, failure handling, completion, and timeout.                                 |
| `apps/holtburger-3d/host/src/{client_runtime,client_projection,protocol}.rs`                                                                                              | Client host command/event boundary.                                                                                         |
| `apps/holtburger-3d/src/client/client-host-contract.ts`                                                                                                                   | Browser-facing typed contract.                                                                                              |
| `apps/holtburger-3d/src/client/{client-hud-layout,client-item-drag,client-inventory-state,client-inventory-currencies,client-inventory-art,client-inventory-sections}.ts` | Layout, dragging, inventory facts, currency totals, artwork ownership, and grids.                                           |
| `apps/holtburger-3d/src/client/ClientInventoryPanel.svelte`                                                                                                               | Existing inventory interaction and panel integration.                                                                       |
| `apps/holtburger-3d/src/app/{ItemCellVisual.svelte,item-cell-presentation.ts}`                                                                                            | Presentation-based cells; no entity requirement in the visual component.                                                    |
| `apps/holtburger-3d/src/harness/browser/client-inventory-probe.ts`                                                                                                        | Browser verification precedent.                                                                                             |
| `apps/holtburger-3d/src/client/client-lifecycle-session.ts`, `apps/holtburger-3d/src/lib/host/host-transport.ts`, `apps/holtburger-3d/host/src/protocol.rs`               | Command registration, event envelopes, runtime schemas, and subscription delivery; projection alone does not reach the HUD. |
| `apps/holtburger-3d/src/client/{client-ui-contract,client-ui-defaults,client-settings-contract}.ts`                                                                       | HUD surface declaration, default placement, and versioned persisted layout migration.                                       |
| `ACE/Source/ACE.Server/Network/NetworkSession.cs`, `crates/holtburger-session/src/session/{receive,send}.rs`                                                              | UIQueue ordering, ordered packet delivery, and fragment completion.                                                         |
| `apps/holtburger-cli/src/pages/game/domains/trade_vendor.rs`                                                                                                              | Existing standalone TUI buy/sell commands and vendor snapshot consumers.                                                    |
| `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/trade/render.rs`                                                                                                | Inline vendor pricing to replace with the shared helper.                                                                    |
| `apps/holtburger-cli/src/pages/game/domains/player.rs`, `apps/holtburger-cli/src/update/world.rs`                                                                         | TUI busy-operation result handling and event routing.                                                                       |

### Proven transaction gap

ACE can filter out invalid sale entries and sell the remaining entries. For each
successfully removed item it sends an item-to-vendor containment event, before
the terminal `UseDone`. These events are also sent for items subsequently
destroyed instead of retained in vendor stock. Stock presence is therefore not a
sale acknowledgment.

ACE can send `InventoryServerSaveFailed` followed by error-free `UseDone`. Before this implementation, core
emitted the failure separately without retaining it in the busy outcome;
that could produce an apparently successful completion. A vendor controller must
not interpret the existing error-free completion alone as successful selling.

Before this implementation, the h3d projection surfaced busy-operation timeouts
but not ordinary completion. Neither a resolved command submission nor a toast is a completion
contract.

### Constraints and accepted concessions

- Purchase currency comes from vendor terms, never from scanning merchandise.
  Sales pay pyreals in ACE. An alternate-currency purchase combined with a sale
  can affect two currencies. Use the existing authoritative storage ownership domain for aggregation. The
  frontend inventory helper filters its output to a fixed currency catalog and
  positive balances, so shared vendor evaluation counts requested WCIDs directly
  from world storage; zero balances and currencies outside that catalog work. The vendor supplies the currency name; missing
  artwork must not prevent trading.
- Whole-stack selling fits the inspected ACE implementation: requested quantity
  is validated, but the source object is then removed and priced as a whole.
- A merged sale cell retains all source IDs and their full quantities; its total
  may exceed physical maximum stack size. It never merges server entities.
- Queuing the same owned source twice cannot double-count it. Repeated additions
  of an unlimited vendor offer increase requested quantity. Finite offers are
  whole-object selections; the wire does not distinguish finite default stock from
  unique resale stock, and ACE transfers a resale object irrespective of a requested
  partial quantity. Conservatively require the described whole stack for finite
  offers, without quantity editing.
- Sale and purchase remain independent server operations. If buying fails after
  selling, the sale stands. Report that plainly and retain unfulfilled buy entries.
- A settled sale refusal does not cancel a queued purchase. ACE checks the actual
  currency balance during buying; a send failure or timeout still stops progression
  because the preceding operation did not reach a definite completion.
- Local eligibility catches known refusals; it does not promise server acceptance.
  Unknown required facts remain explicit rather than becoming invented defaults.
- Decision: follow retail's per-unit minimum/maximum sale-value checks, even though
  ACE's inspected sale handler does not enforce those limits. Preserve the vendor
  terms in world state and apply the rule in shared sale eligibility before h3d
  admits an item to its queue. Match retail's integer per-unit calculation,
  unbounded sentinels, inclusive boundaries, and maximum-value item-type exception.
- Ordinary timeout handling stops progression. No automatic retries or persistence
  across reconnects are introduced.
- The source investigation establishes an ACE-backed design. ACE keeps UIQueue
  messages in order when a fragment cannot fit; sale acknowledgments, failures,
  and `UseDone` are small UIQueue messages. Our session orders packets, but emits
  fragmented messages when complete rather than globally sorting all completed
  messages. Test the specific acknowledgment-before-completion guarantee, including
  an intervening fragmented vendor refresh; do not claim universal message ordering
  or add a delay between phases.
- ACE splits requested default-stock quantities at maximum stack size and applies
  price rounding to each created object. Shared quotes must model those chunks,
  not multiply a rounded unit price. Sold source stacks are priced independently.
- Same-vendor snapshots replace stock while preserving the draft and execution
  state. A sale produces such a refresh before its payout and `UseDone`; do not
  treat every snapshot as a fresh interaction or use its balance as completion.

## North stars and ownership

1. Reuse existing UI and operation mechanisms before adding new ones.
2. Compute semantic facts once at their owning layer; consumers read the contract.
3. Keep vendor offers separate from spatial world entities.
4. Make the normal path small: draft, sell acknowledgment, buy completion.
5. Preserve source identity behind visual grouping.
6. Add only fields with named consumers and tests for meaningful behavior.

| Layer            | Responsibility                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol         | Existing vendor terms, item profiles, containment acknowledgments, failures, and completion messages. No HUD shapes.                   |
| World            | Vendor facts, reusable pricing and sale eligibility, and stack compatibility facts usable by either client.                            |
| Core             | Reusable trade execution and outcome tracking, reusing busy-operation ownership and timeout.                                           |
| h3d host adapter | Narrow typed projection of offers, semantic quotes/checks, commands, and outcomes. No second transaction controller.                   |
| h3d frontend     | HUD registration, retail-like category presentation, drag gestures, draft grouping, queue editing, borders, currency line, and toasts. |
| Content          | Existing static icon/reference queries where needed. No vendor interaction policy.                                                     |

Keep category labels/order and grouping policy app-local. Shared item types and
vendor rules remain available independently of those categories. Quote/eligibility
decisions must not be duplicated in TypeScript; use existing projection/query
patterns to deliver the facts the draft consumes.

## Flow and contract constraints

```text
Vendor wire snapshot → world vendor state → typed h3d projection → catalog
Owned inventory + vendor terms → shared eligibility/quotes → frontend draft

Trade(draft)
  ├─ selling entries present → core sends Sell
  │    → record expected item-to-this-vendor acknowledgments and failures
  │    → UseDone
  │       ├─ sale-only → report completed/partial sale
  │       └─ buying entries present → retain sale issue and proceed
  └─ buying entries present → core sends Buy → completion/failure → outcome
```

Use a phase discriminant rather than independent booleans for idle, selling, and
buying. Retain only evidence consumed by the active phase: vendor identity,
submitted sale sources, acknowledged sources, failure evidence, and the pending
buy request. Do not introduce another timeout owner or general transaction engine.

The final result must distinguish full completion, sale failure/partial sale, and
purchase success or failure after either sale outcome. Include acknowledged sale IDs where the
frontend needs them to remove sold source contributions from merged draft cells.
Do not report the entire merged cell as sold when only one source was acknowledged.

Failure evidence is independent of an optional error code: a reasonless failure
packet still means failure. Observe only relevant sale acknowledgments, matching
both expected item IDs and the active vendor. Do not parse localized toast text
to decide whether to advance.

Draft evaluation is a separate read-only path, following the inventory preview
precedent: h3d sends a candidate draft with a request sequence and vendor identity;
core calls the world-owned evaluator and returns source-level acceptance and a
complete quote. Only the current response may commit a candidate addition or
enable Trade. Reject a bad candidate with its reason; do not silently trim it.
The frontend sums/groups display facts but does not implement price rounding or
eligibility rules. Existing queued entries and proposed additions remain distinct
until acceptance, so rejected items never become committed queue entries.

The quote owns per-currency current/projected balances and phase affordability.
Include removal of sold currency items and receipt of purchased currency items,
not just sale proceeds minus purchase costs. A purchased token cannot fund that
same purchase, and a sold token is no longer available as payment. This is draft
evaluation, not an extra server recheck between Sell and Buy. Reuse the existing
ownership-counting pattern at the semantic owner rather than copying the frontend's
hard-coded currency catalog into world.

Submission carries the explicit vendor/item/quantity intent, never a trusted
client-provided price or eligibility verdict. Correlate results with that execution
so a late outcome cannot edit a new draft. Keep this to ordinary request identity,
not persistent recovery state.

## Phased implementation

### Phase 1: Establish semantic inputs and focused transaction fixtures

Deliverables: targeted changes in world vendor hydration/semantics and colocated
tests; reusable fixtures for the core transaction phase.

- [x] Trace sale success, total rejection, partial rejection, and purchase failure
      through ACE enqueue order and our transport/message dispatch. Prove that the
      acknowledgment set is complete when its terminal `UseDone` is consumed.
- [x] Inspect ACE's underlying sellability and stack-merge predicates before
      choosing shared checks. Reuse or extract the smallest existing compatibility
      predicate; physical destination space must not limit visual grouping.
- [x] Trace unit, stack, and batch price calculation, including rounding and
      promissory-note exceptions. Preserve per-source/per-wire-entry rounding when
      visual cells merge; never price the merged display total as a new server stack.
- [x] Establish vendor-offer purchase quantity semantics from ACE/retail. Unlimited
      supply is not an infinite stack to queue. Use a finite offered stack quantity,
      or one unit for a unit offer, and document the derived rule in the contract.
      Purchase wire amounts are units: ACE's `ItemProfileToWorldObjects` chunks them
      into created stacks. Distinguish that amount from the packed supply count and
      the description's stack count. Unique resale objects are whole-object offers;
      do not infer that finite stock supports partial-object purchases.
- [x] Add shared quote and eligibility facts with explicit unknown-data handling.
      Preserve decoded acceptance terms only where a named consumer requires them.
      Retain min/max values for the explicitly selected retail eligibility rule.
      Implement `VendorProfile::InqAcceptability` (acclient.c:485596) per-unit limits:
      divide value by nonzero stack count using integer division, otherwise use the
      object's value; treat `0xFFFFFFFF` as unbounded and accept equality at each bound.
      Resolve the maximum-value item-type exception to its named flag and reproduce
      it rather than applying an unconditional upper bound. Document that these are
      retail client restrictions despite ACE's more permissive sale handler.
      Test equal/below/above bounds, unbounded sentinels, stacked versus non-stacked
      values, integer truncation, and the item-type exception.
      The retail predicate does not consult the magical-items field, so do not add a
      magical-item restriction merely because that field exists on the wire.
- [x] Migrate the TUI vendor price display to the shared pricing helper while
      retaining its existing presentation and interaction model.
- [x] Cover accepted types, retained/unsellable flags, zero value, and nonempty
      containers using proven rules; inspect existing equipped-item handling rather
      than inventing a blanket prohibition.
      Unknown server-only flags do not require appraising every owned item before a
      sale. Reject known failures and reserve a pending state for facts actually needed
      to quote or determine the requested source quantity.

Acceptance: fixtures expose the current failure/completion mismatch, full versus
partial sales are distinguishable without currency checks, and quotes/checks have
one shared owner. No runtime DAT files are required by retained unit tests.

### Phase 2: Implement core sell-then-buy execution

Deliverables: a focused vendor execution path alongside existing client commands,
typed outcomes, and corrected relevant busy-operation failure handling.

- [x] Introduce one reusable combined vendor command using existing wire buy/sell
      requests. Preserve standalone commands for their real consumers; converge shared
      completion logic instead of creating divergent implementations.
- [x] Retain phase evidence under existing busy-operation ownership. Prevent a
      competing busy operation or duplicate Trade from slipping between sell and buy.
      The existing `finish_busy_operation_from_use_done` takes and clears ownership;
      refactor its vendor transition before publishing idle/completed events. Keep
      the original combined request until the final phase rather than chaining two
      public commands through an event listener.
- [x] Record matching sale acknowledgments and explicit failures. At `UseDone`,
      advance a combined request with any sale issue retained for the final result.
- [x] Handle buy-only and sell-only drafts; reject an empty request.
- [x] Treat reasonless inventory-failure events as failures for both vendor phases.
- [x] Use existing timeout behavior to stop and report; add no retry/recheck logic.
- [x] Turn command-send errors into terminal execution failure and release its
      busy ownership. Do not leave a failed send waiting for `UseDone` or misreport
      local busy rejection as a successfully accepted trade.
- [x] Emit one typed execution outcome suitable for queue updates and feedback.
- [x] Adapt TUI completion consumers and fixtures to any changed shared contracts.
      Verify its standalone Buy and Sell actions still dispatch only their requested
      operation and benefit from corrected failure reporting.

Acceptance: unit tests prove full sale leads to exactly one buy; partial sale,
reasonless failure, nonzero `UseDone`, and timeout lead to no buy. Tests also cover
unrelated/duplicate acknowledgments, buy-only, sell-only, and purchase failure after
a sale, plus failed sends and phase transitions without an idle gap. Existing
use/cast/inventory completion behavior remains correct.
Focused TUI tests confirm its separate buy/sell workflow remains intact.

### Steering checkpoint

- [x] Review the final outcome contract against the frontend's exact consumers.
- [x] Walk a merged two-source sale where only one source succeeds through the
      entire proposed queue update. Remove unnecessary fields or duplicated state.
- [x] Confirm the implementation still excludes balance rechecks and recovery
      machinery. Record any source-backed correction to quantity or price assumptions.

### Phase 3: Project vendor state and build the frontend draft model

Deliverables: host commands/events, matching browser contracts, and focused
`client-vendor-*` state/contract helpers under the client frontend.

- [x] Project initial vendor state, stock refreshes, closure, and identified-offer
      updates through existing client event delivery. Include icon/inspection facts
      without making offers into entities or reloading all artwork on every update.
- [x] Project the shared eligibility/quote facts and execution outcomes. Reuse the
      inventory currency aggregation and pending-data presentation patterns.
- [x] Wire draft preview and submission end to end: core commands/events, host
      runtime command registry, `ClientHostEvent`, outer `HostEvent` conversion, host
      transport command/event lists, lifecycle-session listeners, and browser schemas.
      Mirror the sequence-correlated inventory preview path; add a round-trip test
      that reaches the frontend owner rather than testing projection in isolation.
- [x] Implement source-backed draft entries and compatible-stackable display groups.
      Keep Buying and Selling disjoint. Non-stackables always remain separate.
- [x] Owned-source addition is idempotent; vendor-offer additions accumulate. Keep
      finite supply, chosen purchase quantities, and sale source quantities distinct.
- [x] Provide remove and clear actions. Stackable purchase quantities are chosen
      in an inventory-style prompt before queue admission; sales remain whole-source-stack selections.
      Removing a merged sale cell removes its queued source contributions.
- [x] Compose all relevant currency balances on one line, including zero balances
      and pyreal proceeds at alternate-currency vendors. Mark insufficient projected
      funds and pending facts without claiming a final server guarantee.
      Cover an unknown-to-catalog currency, nested carried stacks, sold payment tokens,
      and purchased currency. Ignore obsolete preview responses after draft edits or
      vendor replacement; freeze the submitted request while execution is pending.
- [x] Disable Trade for an empty/invalid draft, missing required quote facts,
      insufficient projected currency, or an active execution.
- [x] Apply typed results to remove acknowledged sales and completed purchases;
      retain unsold sources or unfulfilled purchases after failure. Avoid duplicate
      error toasts from generic feedback and the vendor result.

Acceptance: contract and pure draft tests cover compatible-only grouping, no
double-counted source IDs, totals exceeding stack size, per-source rounded quotes,
two-currency projections, and partial removal from a merged group.

### Phase 4: Integrate the vendor HUD and interactions

Deliverables: `ClientVendorWindow.svelte` and integration with the current HUD shell,
item drag owner, artwork leases, input policy, and standard panel layout.

- [x] Open/update the standard-layout vendor window from the active interaction.
      Use existing focus, sizing, positioning, and persistence conventions.
      Add the vendor surface to `client-ui-contract.ts`, `client-ui-defaults.ts`, the
      typed layout, and the client HUD composition. Advance the existing settings
      schema/migration chain to add default vendor placement without discarding saved
      placements. Keep existing strict schema handling rather than adding fallbacks.
- [x] Render nonempty retail-like category sections in a scrollable item grid.
      Define deterministic handling of composite/overlapping and unrecognized item
      types so merchandise is not accidentally hidden or duplicated.
- [x] Reuse `ItemCellVisual` and its presentation helpers. Extend facts only when
      vendor quantity/supply or queued quantity needs a real new display capability.
- [x] Support vendor drag and double-click, plus owned-inventory drag into the queue.
      Reject known-unsellable drops with a reason. Preserve inspection and provide a
      keyboard-accessible queue action without stealing inventory's normal double-click.
      `client-item-drag.ts` currently resolves sources as owned entities. Add explicit
      vendor-offer source and vendor-queue destination variants to the gesture path;
      offer drags cannot accidentally invoke inventory move/equip/give. Queue drops
      request draft evaluation rather than submitting a physical inventory operation.
      Keep one pointer-gesture owner; do not add competing global drag listeners.
- [x] Render the currency line, bounded wrapping queue with empty placeholder,
      labeled/color-bordered Buying and Selling groups, and persistent Trade footer.
- [x] Show vendor prices and quantities in accessible tooltips/labels. During
      execution freeze draft changes and show Selling/Buying progress.
- [x] Use ordinary interaction closure to clear an idle draft and vendor switching
      to replace it. Execution ownership remains in core; hiding a panel does not cancel
      a sent command. Do not build special recovery UI around closure.

Acceptance: the browser harness exercises the actual panel with synthetic offers
and inventory; drag, double-click, removal, mixed currencies, overflow, focus,
disabled states, and result feedback work without browser errors. User performs
visual acceptance of layout, grouping, colors, density, and interaction feel.
Also verify same-vendor stock refresh preserves the draft, different-vendor state
replaces it, old saved layouts migrate, and offer inspection does not require an
entity-mirror entry. Exercise the existing object-inspection path with a vendor
offer and extend its typed target resolution only where that path is entity-only.

### Phase 5: Integration verification and cleanup

- [x] Run an end-to-end synthetic sequence through production command/event
      boundaries, including partial sale and buy-after-sale failure.
      Include a fragmented stock refresh between sale acknowledgments and completion,
      stale draft-preview responses, a reasonless purchase failure, and independent
      ordinary inventory failure traffic while a vendor request is active. Match
      failure identities to the pending request rather than absorbing every inventory
      failure into the trade.
- [x] Live verification was not required for this pass. No live trades were made
      and the interactive TUI was not launched. Future live verification must use
      explicitly disposable items through the noninteractive probe/debug harness.
- [x] Run focused Rust tests for changed world/core/host code and TypeScript tests
      for the changed contracts/draft. Run `cargo fmt --check`, scoped Clippy with
      `--all-targets -- -D warnings`, and h3d's `npm run check`, `npm run lint`,
      `npm run format:check`, and `npm run build` as applicable to changed files.
- [x] Compile `holtburger-cli`, run its focused vendor/completion tests, and include
      affected TUI code in formatting and Clippy checks. Verify price rendering uses
      the shared helper and standalone actions do not invoke combined trading.
- [x] Use `npm run harness:browser -- ...` for the browser evidence. Retained tests
      use checked-in/synthetic fixtures rather than untracked runtime assets.
- [x] Remove duplicate price/eligibility logic introduced or displaced by this
      work, dead contract fields, temporary diagnostics, and obsolete terminology.
      Do not expand cleanup into unrelated TUI redesign.
- [x] Review added lines and abstractions. Prefer a small controller and pure
      semantic/draft helpers over a generalized commerce framework.
- [x] Update durable architecture/protocol documentation only for contracts changed
      by implementation. Keep this plan's checklist and course corrections current.

## Risks and mitigations

| Risk                                                            | Mitigation                                                                                           |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `UseDone(None)` mistaken for success                            | Retain explicit failure evidence and expected sale acknowledgments.                                  |
| Partial sale hidden by a visually merged cell                   | Keep source contributions and remove only acknowledged sources.                                      |
| Price differs after visual merging                              | Quote real source/request entries with server rounding before summation.                             |
| Currency preview uses only an open subcontainer                 | Verify ownership-wide aggregation scope; reuse its mechanism, not an unsuitable view slice.          |
| Existing currency catalog omits vendor currency or zero balance | Resolve rows from vendor terms and count requested WCIDs; artwork is optional.                       |
| Catalog refresh clears a pending purchase draft                 | Preserve draft identity for updates to the same vendor.                                              |
| Correct host projection never reaches the browser               | Cover outer event conversion, transport registration, session schemas, and subscriptions end to end. |
| New HUD surface invalidates saved layouts                       | Add a migration through the existing versioned settings chain.                                       |
| Unlimited stock confused with stack quantity                    | Separate supply from finite requested amount in the offer contract.                                  |
| Overly strict inferred acceptance checks                        | Prove predicates against ACE/retail; represent unknown facts explicitly.                             |
| Queue consumes the catalog area                                 | Cap queue height; keep currency/footer visible; user visual acceptance.                              |
| Extra state machines or recovery scope                          | Reuse busy ownership and stop at a typed terminal outcome.                                           |

## Definition of done

- [x] Agreed HUD, grouped catalog rows, currency line, whole-stack queue, compatible
      merging, and sell-then-buy behavior are implemented.
- [x] A settled failed or partial sale still dispatches a queued purchase;
      timeout and command-send failure stop progression.
- [x] Purchase failure after a sale is accurately reported without replaying sales.
- [x] Vendor offers remain separate from world entities; shared semantics and
      frontend policy respect the layer table above.
- [x] Required checks and meaningful unit/integration/browser verification pass.
- [x] The TUI retains its vendor workflow, consumes shared pricing and corrected
      completion behavior, and passes compilation and focused integration tests.
- [ ] User visual acceptance is complete; automation does not substitute for it.
- [x] No rollback/reconnect machinery, automatic retries, or unnecessary generalized
      infrastructure was added.

## Open questions and execution notes

Source-level questions about offered quantities, compatibility, eligibility, and
event ordering are resolved in the implementation and evidence below. The remaining
gate is user review of panel dimensions, category presentation, border colors,
quantity controls, and interaction feel.

The min/max policy is settled: follow retail's per-unit acceptance rules. It is
not an open choice between retail and ACE enforcement.

Record implementation discoveries and resulting course corrections here as the
phases execute.

### Implementation evidence and remaining work

Implemented ownership:

- World retains retail per-unit bounds, integer truncation, inclusive limits,
  unbounded sentinels, and the promissory-note exception. A zero stack count uses
  the object's value for the retail predicate, but cannot be submitted as a zero
  quantity. It also owns eligibility, per-source pricing, created-stack purchase
  rounding, and ownership-wide currency evaluation.
- Stack compatibility is one property-trait primitive, shared by physical merge
  evaluation and quote merge keys. Display groups can exceed physical capacity
  while preserving source IDs. Sold payment tokens cannot also fund a purchase;
  purchased currency cannot fund itself.
- Core owns standalone and combined vendor execution under the existing busy
  owner. Matching receipts and retained failures establish the sale result. Partial
  sales proceed to buying when queued; failed purchases retain confirmed sale IDs.
  A completed purchase clears its buy queue even after a partial sale. There is no balance
  recheck between phases, retry, rollback, or reconnect recovery.
- Core's command loop treats returned errors as fatal: ordinary draft/busy
  refusals therefore publish correlated results and return normally. Network send
  failures preserve existing transport failure behavior while releasing busy state.
  Vendor outcomes own their error feedback; unrelated inventory failures still
  publish their own feedback.
- The narrow host projects catalogs, quotes, phases, and outcomes. The frontend
  owns category ordering, draft admission, compatible-only visual grouping,
  removal, pre-queue quantity choice, gesture routing, artwork leases, and bounded display
  updates. Vendor offers remain separate from entity state.
- The standard HUD includes `ClientVendorWindow.svelte`; version-10 settings migrate
  existing placements and add the vendor placement. Existing ItemCellVisual and
  pointer-gesture ownership are reused. The TUI consumes shared prices and corrected
  standalone completion handling without receiving a combined-trade UX.

Source-backed corrections and integration findings:

- `IsSellable` is an assessment property absent from ordinary item creation.
  Unappraised owned items can therefore pass local eligibility and be refused
  by ACE during selling. The final receipt preserves the accepted sale IDs and
  attempts any queued purchase after the sale reaches `UseDone`.
- Purchase currency comes from vendor terms. Sales pay pyreals, so alternate-currency
  vendors can expose two balances in the same line.
- Finite offers are treated as whole objects because the wire does not identify
  resale versus finite default stock. Catalog tooltips quote the described stack,
  not a fabricated rounded unit price. Pre-queue quantity choice applies to
  stackable offers; finite offers expose only their whole-object quantity.
- A same-vendor stock refresh must preserve an in-flight draft candidate, not only
  the last admitted draft. Superseded quote responses are ignored.
- The browser probe caught gameplay focus policy blurring vendor buttons. The
  panel now registers with the existing native-control input scope; Enter queues
  and the configured Examine shortcut inspects without competing global handlers.
- The command-boundary integration fixture caught item types being hydrated only
  on spatial entities, leaving real vendor offers without a type. The mapping now
  lives in shared public-description hydration; the duplicate entity mapping was
  removed. The fixture decodes an actual ApproachVendor message before previewing
  and submitting the draft, so property-seeded helpers cannot hide that gap.

Initial implementation verification (2026-09-22, before permissive sale continuation):

- Full world (890) and core (534) unit suites, focused TUI vendor tests (3), and
  the session suite (29) pass. Socket-dependent tests require local socket access; sandbox EPERM failures
  were rerun with that access rather than treated as code failures.
- The session fixture proves sale receipts and an intervening fragmented vendor
  refresh precede terminal UseDone, including reordered datagrams. This tests the
  ACE UIQueue path, not a claim of universal cross-queue ordering.
- A production command/message fixture covers a 3,000-pyreal balance plus two sale
  sources worth 7,000 funding a 10,000 purchase. The later continuation change
  extends it to cover partial-sale progression and purchase refusal, retaining
  exact sold source IDs.
- A shared checked-in JSON fixture is verified by the Rust host event serialization
  and consumed through the real browser lifecycle session into the draft owner.
- Full TypeScript suite passed 2,669 tests before the final fixture addition;
  subsequent focused vendor/lifecycle tests pass, including that new fixture.
- h3d check (zero errors/warnings), ESLint, Knip, Prettier, production build, Rust
  formatting, and scoped all-target Clippy with warnings denied pass. The Vite
  build emits a chunk-size advisory; its baseline was not established in this task.
- `npm run harness:browser -- --client-hud --brief --screenshot
/tmp/holtburger-vendor.png` passes the full HUD suite. Vendor coverage includes
  category scrolling, the original square cells, two currencies, whole-stack drag, compatible
  merging, double-click, Enter, inspection without an entity entry, removal/clear,
  rejection, execution freeze, stock refresh, and failed-purchase feedback. Offer
  drags cannot submit an inventory move/equip/give operation.
- Browser evidence: `/tmp/holtburger-vendor-report.txt`; vendor screenshot:
  `/tmp/holtburger-vendor.png.vendor.png`. Icons in this fixture are synthetic.
- The first visual review led to a catalog inset, bordered currency line with
  inventory currency artwork, side-by-side Buying/Selling queue groups, compact
  right-aligned actions, and a separate remove control. Stackable purchases now
  enter through a quantity dialog shared with inventory splitting. Finite offers
  still require the whole described object; unlimited stock accepts a positive
  wire-sized quantity. The queued quantity input was removed. The host catalog
  now carries the stackability fact and WCID used by the frontend dialog and
  currency artwork, respectively. Known currencies reuse inventory icon data;
  carried or offered currency items supply their own icon; unavailable artwork
  falls back to a neutral currency glyph.
- The revised browser run confirms 8px catalog padding, a visible currency
  divider, two icon slots, queue groups sharing one row, compact footer alignment,
  and a separate top-right remove button. Its final rerun also confirms the quantity prompt
  opens on drag, Cancel restores offer focus, confirmation queues the chosen
  purchase, and Enter opens the same prompt. Full TypeScript suite: 2,670 passed; Rust host
  contract test and scoped Clippy pass. Production build succeeds with the same
  chunk-size advisory. Final browser report:
  `/tmp/holtburger-vendor-accepted-candidate-report.txt`; panel screenshot:
  `/tmp/holtburger-vendor-accepted-candidate.png.vendor.png`; quantity prompt:
  `/tmp/holtburger-vendor-accepted-candidate.png.vendor-quantity.png`.

Quality review removed unused catalog/contract fields and exports, kept pricing
and eligibility out of TypeScript, and verified the core/host/frontend ownership
split. The added code is a vertical slice with colocated semantic, orchestration,
contract, and gesture tests; it introduces no general commerce framework.

Remaining: user visual acceptance of the revised panel, catalog rows, and quantity dialog,
including density, colors, and interaction feel. Do not mark the overall
implementation accepted solely from automation.

The next user review refined queue interaction: the large dark remove overlay was
replaced with a small floating corner button that appears on hover or keyboard
focus. Clicking a queued item selects it without inspection; the configured
examine shortcut (E by default) or right-click inspects its source. Only the
corner button removes the queued entry. The full HUD browser run passes with
explicit checks for hover visibility, button placement, selection without an
inspection request, E and right-click inspection, unchanged draft on cell click,
and removal by the separate button. Final report:
`/tmp/holtburger-vendor-select-then-inspect-report.txt`; screenshot:
`/tmp/holtburger-vendor-select-then-inspect.png.vendor.png`.

Permissive sale continuation follow-up (2026-09-22): after a definitive sale
`UseDone`, core attempts the queued purchase even with missing sale receipts or
an inventory failure. The final receipt carries the sale issue independently of
the buy result. H3d warns once on an incomplete trade, clears buys only when the
buy succeeds, and retains only unsold sale sources. Ten focused core vendor tests,
ten frontend vendor-state tests, the host wire-fixture test, h3d check and ESLint,
scoped all-target Clippy with warnings denied, Rust formatting, and diff checks
pass. The socket-dependent failed-send test could not bind in this sandbox
(`EPERM`); its unchanged path was not rerun outside the sandbox for this follow-up.
No new visual acceptance was performed for the changed result flow.

The catalog now renders each offer as an icon, name (including described stack
count), and quoted price in the vendor's currency. Category grouping, selection,
Examine shortcut/right-click, and buy drag/double-click/Enter gestures remain.
The queue retains item cells. `npm run check`, `npm run lint:ts`, and the full
`npm run harness:browser -- --client-hud --brief --screenshot
/tmp/holtburger-vendor-list.png` pass. The browser probe confirms full-width
rows with visible price and the existing transaction gestures; screenshot:
`/tmp/holtburger-vendor-list.png.vendor.png`. User visual acceptance remains.

Currency-display follow-up (2026-09-22): the host snapshot now carries the
vendor payment WCID with its name, so catalog artwork does not depend on a
settled quote. A small app-local amount component renders icon then amount for
catalog prices, balance projections, and buy/sell queue totals; the tooltip and
accessible label retain the currency name. The host wire-fixture test, 10
vendor-state tests, 27 lifecycle tests, h3d check, ESLint, scoped all-target
Clippy with warnings denied, Rust formatting, and the full browser HUD harness
pass. The browser probe confirms all three display sites and existing trade
gestures. Screenshot: `/tmp/holtburger-vendor-currency-icons.png.vendor.png`.
The first browser attempt stopped before the vendor probe on an unrelated
inventory-hover cursor assertion; a later attempt reached the vendor probe and
exposed a whitespace-sensitive assertion, which was corrected before the
passing run. The lifecycle test's expected purchase-failure message was also
updated to match the existing frontend behavior.

Affordability and summary follow-up (2026-09-23): quoted catalog prices above
the projected payment balance use the theme danger color. The currency line
shows signed deltas in parentheses and aligns its full contents to the right
while retaining horizontal overflow. Only a negative projected balance is red;
the delta keeps the normal text color. Queue headings read "Buying for" and
"Selling for" before their icon and amount. H3d check, ESLint, Prettier, and
the full browser HUD harness pass. The browser probe verifies both an
unaffordable offer and a positive-balance/negative-delta case, then injects a
negative projected balance to verify that only the balance turns red. Browser
report: `/tmp/holtburger-vendor-summary-final-report.txt`. Visual acceptance
remains with the user.
