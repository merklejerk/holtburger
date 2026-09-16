# Combat spell shortcut bar

Status: implementation, presentation follow-ups, and final code-quality review verified.

Current behavior supersedes the original strip constraints below: independently themed blue cells, compact tabs, and a grid-icon button that toggles 1×10 / 2×5 on click. No drag-resize gesture remains on shortcut bars.

## Context and boundaries

Give the 3D client a magic-stance spell shortcut surface that supports combat casting without opening the spells panel.

In scope: ten fixed numbered tabs, ten numbered spell cells per tab, spell drag/drop, keyboard and pointer casting through the existing cast path, mana-colored presentation, and HUD layout integration.

Out of scope: persistence, automatic spell upgrades, casting queues, repeat/held-key casting, new targeting semantics, spell execution changes, configurable tab counts, cloning/reordering tabs, and action-bar feature expansion. This is an app-local frontend feature; no shared Rust crate or host contract changes are expected. Retail motivates the UX, but the agreed product behavior below is the contract; do not invent undocumented retail semantics.

## Ground truth and existing patterns

Paths below are relative to `apps/holtburger-3d/` unless otherwise stated.

| Source | Relevant responsibility |
| --- | --- |
| `src/lib/input/keyboard-input-policy.ts` | Sole keyboard boundary; active scope first refusal, scope activation, then game dispatch. Owns cancellation and press/release routing. |
| `src/lib/input/input-contract.ts`, `input-defaults.ts`, `app-input.ts` | Typed bindings and key interpretation, including `InputDigitIndex`. |
| `src/client/ClientApp.svelte` | `handleGameKeydown`, shared `castSpell`, session/service composition. Casting captures current selection and reports failures through toasts. |
| `src/client/client-lifecycle-session.ts` | `castSpell` requires an active session and confirmed magic stance, then submits the normal aim request. |
| `src/client/ClientActionBar.svelte`, `ActionCell.svelte` | Focused digit handling, alternate activation, cell appearance, click behavior, and layout patterns. |
| `src/client/ClientActionBars.svelte`, `client-action-bar-state.ts` | Session-local item bindings, reconciliation, and item drag composition. Item-specific content must remain item-specific. |
| `src/client/client-item-drag.ts` | Pointer threshold, drag ghost, click suppression, swaps/removal, cancellation. Currently registers the only Escape-cancellation callback. |
| `src/client/ClientSpellsPanel.svelte`, `client-spells.ts` | Spell membership, references, artwork leases, and existing cast callback. |
| `src/client/ClientWorldView.svelte`, `ClientHudPanel.svelte` | Runtime/layout mode, HUD composition, placement editing and viewport fitting. |
| `src/client/client-ui-contract.ts`, `client-ui-defaults.ts`, `client-hud-layout.ts` | Typed surface inventory and initial/canonical placement. |
| `src/app/ui-base.css`, `src/app/themes/holtburger-standard.css` | `--ui-color-mana`, already consumed by the mana meter. |
| `src/harness/browser/ClientHudHarness.svelte`, `client-spells-probe.ts`, `scripts/client-action-bar-probe.mjs` | Deterministic browser fixtures and existing spell/action-bar behavior probes. |

### Constraints and concessions

- Exactly ten tabs and ten cells per tab, each displayed in order `1,2,3,4,5,6,7,8,9,0`. Initial selection is tab 1; all bindings start empty. Repeated spell IDs are allowed.
- One surface and one placement for every tab; only the selected tab's cells are displayed.
- Runtime visibility requires confirmed magic stance in an active world session. Layout mode shows a preview regardless of stance and never casts.
- Leaving magic stance, switching tabs, closing the spell panel, or entering layout mode preserves bindings and selected tab. A different character or retired session resets bindings/tab selection; temporary resync does not erase them.
- Plain digit activates the selected tab's corresponding cell. Shift+digit changes tabs. Ctrl/Alt/Meta chords are not spell shortcuts. Repeats do not cast or switch tabs.
- Focused action bars retain first refusal, including their existing Shift+digit alternate behavior. Editors and modals retain existing ownership. No extra global keyboard listener, scope-priority registry, or focused spell-bar mode.
- Empty cells consume a matching gameplay shortcut without casting. Unknown/pending spell membership disables activation without deleting bindings. A no-longer-known spell remains visibly unavailable and removable; do not silently substitute another spell.
- Missing artwork must not erase identity or silently remove the shortcut. Use explicit unavailable artwork/definition presentation and existing diagnostics.
- Dragging a spell from the panel copies its ID onto a cell, replacing that destination's shortcut. The spellbook is unchanged. Between cells, swap contents; moving to an empty cell is the same operation. Dropping back on the source does nothing.
- A completed drag from a cell to outside the spell surface clears the source. An invalid drop inside the spell surface cancels. Escape, pointer cancellation, blur, source removal, stance hiding, or character replacement cancels without clearing. A panel-origin drag outside a cell changes nothing.
- No automatic tab switching on hover is required. Cancel an active drag before a tab change so hidden cells cannot receive stale transfers.
- Layout participation initially means a movable, fixed horizontal strip with a tab row, using the existing HUD wrapper and viewport fitting. No rotate/clone or alternate grid shapes. In a narrow viewport, keep cells reachable with overflow rather than losing numbered slots.

## North stars

1. Keep UI policy in the 3D app presentation/input layer and reuse the existing session/core execution path.
2. Route all keyboard intent through the existing owner; consume an event once.
3. Store only binding identity and selection. Resolve spell knowledge, definitions, and images through existing owners.
4. Prefer a small spell-specific model over generalizing item actions into a universal hotbar framework.
5. Reuse visual and pointer mechanics only where it removes demonstrated duplication. Do not copy the item inventory/host-preview machinery into spell dragging.
6. Keep pointer-rate data imperative; cold binding/tab/layout changes may use Svelte state. Every added field and abstraction needs a named consumer.

## Phase 1 — Establish state and composition ownership

Deliverables: `src/client/client-spell-bar-state.ts`, focused unit coverage, and app composition wiring.

- [x] Define documented fixed slot/tab types using the existing digit index concept, with fixed-length nullable spell-ID collections. Do not alias spell slots to item `ActionContent`.
- [x] Implement small pure operations for binding, selecting a tab, swapping, clearing, and resetting. Keep exact source/destination addresses in drag commands.
- [x] Own cold spell-bar configuration at `ClientApp`, accessible to game dispatch and passed down to the HUD. Keep state alive independently of conditional bar markup.
- [x] Hoist the existing runtime/layout mode to the same composition layer and pass mode/change intent to `ClientWorldView`; remove its duplicate local owner. This lets keyboard and pointer activation use one app-owned availability decision.
- [x] Derive spell-shortcut availability once from session lifecycle, confirmed stance, and HUD mode. Give consumers that decision; the session's existing authoritative validation remains intact.
- [x] Reset on actual character identity replacement/session retirement, not transient absent snapshots or stance changes. Follow existing session lifecycle events and avoid an extra polling loop.

Acceptance: fixed addressing, duplicate IDs, swaps and resets work; tab/stance transitions retain configuration; no new host or shared-crate APIs. Helpers have real runtime consumers rather than being created for tests alone.

## Phase 2 — Spell cells and HUD surface

Deliverables: `SpellCell.svelte`, `ClientSpellBar.svelte`, HUD contract/default/layout updates, spell display integration.

- [x] Add `spellBar` to `ClientUiDefaults`, `CLIENT_UI_DEFAULTS`, and `createClientHudLayout`, including an initial placement above the default action bar and fixed strip dimensions derived from cell sizing.
- [x] Mount through `ClientHudPanel` with one canonical placement. Show the bar for magic runtime or layout preview. Keep its binding owner outside conditional markup.
- [x] Render fixed numbered tabs and cells with clear selected-tab feedback, accessible names, spell-name tooltips, and empty/unavailable states. Tab clicks select; cell clicks activate only when available and return keyboard ownership to gameplay.
- [x] Match action-cell geometry, numbering and interaction feedback. Use `--ui-color-mana` for the blue background treatment in the base palette and shipped standard theme. Extract only genuinely common styling needed by both cell types; retain separate spell/item semantics.
- [x] Reuse `ClientSpellServices.load`, membership events, and `UiIconRepository` leases. Load unique bound IDs needed by the visible tab; release consumer leases on tab replacement/unmount and guard asynchronous replies against stale tab/character lifetimes.
- [x] Do not load expanded spell inspection/formula data for shortcut rendering. If compact name/icon preparation duplicates the panel, extract that exact common operation rather than building a new catalog.
- [x] Route clicks through the same app-owned spell-cell activation operation intended for keyboard input, ending at the existing `castSpell` callback.

Acceptance: one visible tab of ten cells; theme-correct tint; stance/layout visibility behaves as specified; switching tabs and closing the spells panel retain bindings; a narrow viewport keeps every cell reachable.

## Phase 3 — Keyboard routing and casting

Deliverables: typed spell-bar bindings in input contracts/defaults/resolver; `ClientApp.handleGameKeydown` integration.

- [x] Add exact-modifier bindings for spell tabs and cells, using physical `Digit1` through `Digit0` so shifted symbols resolve correctly.
- [x] In the existing game handler, consume recognized spell shortcuts when shortcut availability permits. Select a tab or activate a cell once per fresh press; consume matching repeats without executing again.
- [x] Keep the existing top-level routing order unchanged: active scope, scope activation, game handler. Do not register spell shortcuts as scope activation commands or add listeners to the spell component.
- [x] Resolve current tab/cell when the input arrives and capture target selection through the existing `castSpell` callback at activation time. Preserve existing target routing and error toasts.
- [x] Add focused tests using the actual keyboard policy for focused action-bar priority, editors/modals, repeats, exact modifiers, empty cells, unavailable stance, and return-to-game behavior.

Acceptance: plain digits cast and Shift+digits select tabs only in eligible gameplay; focused action bars win even when activation returns ownership to gameplay during that event. One press never both activates an item and casts a spell. No new cast transport path.

## Phase 4 — Drag/drop and shared cancellation composition

Deliverables: narrow spell gesture owner, panel drag sources, cell drop targets, explicit app-level Escape composition.

- [x] Add spell-row drag sources that preserve ordinary expansion and cast-button clicks. Start dragging only after the established pointer threshold; exclude interactive row controls from drag initiation.
- [x] Implement spell-specific pointer state for source ID/address, pointer identity, target address and ghost. Reuse small existing gesture primitives where appropriate; do not broaden inventory targets or item bindings to carry spells.
- [x] Use a common mounted HUD root so panel-to-bar transfer works across surfaces. Validate source/destination ownership before committing; suppress the trailing click after drag so a bind/removal cannot cast or expand a row accidentally.
- [x] Apply the copy/swap/clear/cancel rules above. Preserve source contents until a successful release, and cancel on tab changes or surface/character retirement.
- [x] Move the sole `bindEscapeCancellation` registration out of `ClientItemDrag` into the common app/HUD gesture composition owner. Expose narrow cancel operations from item and spell drag owners and wire their lifetimes explicitly through the existing action-bar composition.
- [x] Compose Escape cancellation in order: active spell/item gesture, then the existing item interaction cancellation. Preserve the existing true/false consumed contract and cleanup behavior. Do not leave both old and new registrations active or add a general handler-priority framework.
- [x] Ensure beginning a spell drag retires any incompatible active item interaction using existing cancellation behavior, and prevents world selection or camera gestures from acting on that pointer sequence.

Acceptance: panel copy, replacement, cell swap, drag-off clear, and all cancellation cases work; drag never casts; item drag/drop and item targeting Escape behavior continue to work. All listeners, ghosts and cancellation endpoints are released with their owner.

## Phase 5 — Integration review, cleanup and verification

- [x] Reassess final ownership and line-count impact. Remove duplicate HUD-mode state, dead cancellation registrations, redundant presentation fields, and speculative abstractions. Keep spell state independent of `ClientItemDrag` and `ActionContent`.
- [x] Extend the existing deterministic client HUD browser fixture to exercise the production spell-bar components and input resolver. Capture cast requests/selection rather than requiring a live server.
- [x] Ensure a routing test also exercises production game-dispatch integration; a fixture that reimplements the dispatcher is not sufficient proof that `ClientApp` handles shortcuts correctly.
- [x] Cover all ten tab/cell mappings including `0`, tab preservation across stance/layout changes, focused action-bar precedence, typing in spell search/chat, modals, and no repeat casts.
- [x] Exercise copy/swap/removal/cancel with actual browser pointer events, including source unmount, blur and stance hiding during drag; verify no trailing cast/row expansion.
- [x] Exercise current-selection capture, cast error feedback, unavailable knowledge, delayed artwork across tab changes/character replacement, and panel closure. Retain existing spell-panel casting coverage.
- [x] Verify HUD movement/anchoring, layout preview without casts, narrow viewport recovery, base/standard theme colors, and spell/action cell visual consistency with browser screenshots.
- [x] Run focused unit tests as each phase lands, then final applicable checks from `apps/holtburger-3d`: `npm run check`, `npm run lint:ts`, `npm run lint:dead`, `npm run format:check`, `npm run test:ts`, and `npm run build`.
- [x] Run `npm run harness:browser -- --client-hud --screenshot /tmp/holtburger-spell-bar.png` with the extended probe. Report actual behavior evidence and any environment limitation. Do not run the TUI or retain tests requiring untracked runtime assets.

Acceptance: static checks and focused/runtime verification pass without warnings or swallowed errors; no unresolved behavior gaps or obsolete code paths remain. No Rust changes are expected; if implementation expands into Rust, justify that scope and run the relevant tests and clippy with warnings denied.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Returning to gameplay during action activation lets the same digit reach spells | Retain `preventDefault` consumption and test through the real keyboard policy. |
| Layout preview disables clicks but leaves keyboard casting enabled | One app-owned availability decision used by both activation paths. |
| Bar remount or transient spellbook absence erases shortcuts | Stable configuration owner; only explicit character/session retirement resets it. |
| Stale load publishes the previous tab/character's artwork | Consumer lifetime guards and explicit lease disposal. |
| Two drag owners compete for Escape or a pointer sequence | One composition-owned cancellation entry point, disjoint source markers, explicit gesture retirement. |
| Reusing item action machinery pulls inventory semantics into spells | Independent spell-ID bindings and narrow gesture mechanics. |
| New bar overlaps default action cells | Initial placement accounts for both surfaces; verify screenshot and constrained viewport behavior. |

## Definition of done

- [x] Ten fixed tabs of ten spell cells, with the agreed numbering and input priority.
- [x] Magic-only runtime visibility plus non-casting layout preview.
- [x] Drag/drop matches the specified mutation/cancellation behavior.
- [x] Clicks and keys use the existing spells-panel casting path with current selection.
- [x] Binding state survives visibility/tab changes and retires with its character/session; no persistence added.
- [x] Shared mana color and action-cell visual consistency, with accessible names and reachable cells.
- [x] Existing item action bars, spell panel, editor/modal routing and gesture cancellation remain functional.
- [x] Applicable checks and deterministic browser verification pass; no shared-crate/host expansion without demonstrated need.

## Open questions and execution notes

No blocking product questions remain. Defaults recorded above intentionally keep the first implementation narrow: horizontal fixed strip, no hover tab switching, and session-local bindings. During execution, record any evidence-driven change to these decisions here before widening scope.

### Implementation evidence so far

- Fixed spell-ID bindings and transfers are implemented in `client-spell-bar-state.ts`.
- Production game dispatch uses `handleSpellBarKeydown`; no keyboard policy ordering changes or extra keyboard listeners were introduced.
- `ClientApp` owns configuration, character reset, layout mode, and shortcut availability. `ClientWorldView` owns mounted gesture composition and the sole Escape-cancellation registration.
- `SpellCell` and `ActionCell` share shortcut geometry/numbering CSS. Item and spell ghosts have distinct identities and shared presentation CSS.
- Initial verification: 301 TypeScript test files / 2,439 tests passed; type-checking and dead-code checks passed. Browser verification is still in progress and these counts do not establish completion.
- The browser harness requires sandbox escalation to bind its local Vite/Chrome ports. One early run was invalidated by HMR; a subsequent run exposed ambiguous drag-ghost identity, which was corrected before rerunning.

- Reference correction: the app ships one standard theme over a base palette, not two selectable bundled themes. Browser coverage checks the tint against both palettes.

### Final verification and review

- `npm run check`: passed with zero errors and zero warnings, including Svelte, app, test, Node and Electron type checking.
- `npm run lint:ts`, `npm run lint:dead`, and `npm run format:check`: passed.
- `npm run test:ts`: 301 files / 2,439 tests passed. New state tests cover fixed addresses, duplicate IDs, swaps, clearing, and independence; new dispatch tests cover every digit, exact modifiers, repeats and input-gate quarantine. Existing spell-service tests cover delayed retention after character reset/destruction and independent display leases.
- `npm run build`: passed. Vite reports a bundle-size advisory for chunks above 500 kB; no bundle-splitting changes were made as part of this feature.
- `npm run harness:browser -- --client-hud --screenshot /tmp/holtburger-spell-bar.png`: passed with exit code 0 after the final delayed-reference case was added. Existing inventory, item drag, action bar, targeting, keyboard-policy, spell-panel, and theme probes also passed.
- New browser coverage verifies panel copying, swapping, drag-off removal, Escape/blur/stance/tab/modal/source-removal cancellation, current-selection cast requests, repeat suppression, action-bar priority (plain and shifted digits), editor/modal ownership, unavailable knowledge, layout preview gating, layout movement, narrow-viewport reachability, and delayed replies across tab changes.
- Browser tint assertions compare empty and populated cells against the resolved mana-derived color under the base palette and standard theme. Screenshot `/tmp/holtburger-spell-bar.png.spell-bar.png` was visually inspected: all tabs and cells are visible without unintended scrollbars at normal size.
- Cast execution/error review: both spell panel and spell-bar activation converge on the existing `ClientApp.castSpell` callback, which captures selection and catches session errors into warning toasts. The session's existing confirmed-stance validation and normal-aim payload are unchanged and covered by session tests; the browser probe checks actual session cast requests. No duplicate casting or targeting policy was introduced.
- Character-lifetime review: `current-state` and `local-player-established` drive identity acceptance. Null/pending identity and ordinary stance changes preserve configuration; replacement identity and session teardown reset it. Pending display work is retired by the component effect cleanup; shared service tests verify obsolete character loads cannot retain artwork.
- Seam review covered input contracts/defaults/resolver → production game dispatch; app-owned configuration/availability → world HUD → spell cell; shared spell-row preparation → panel/bar artwork leases; gesture owner → binding edits; and HUD cancellation → existing item interaction behavior. No host or shared Rust contracts changed, no persistence was added, and no staging/commits were performed.

### Follow-up: compact themed cells and snap resizing

The user's follow-up supersedes the original fixed-strip concession and mana-token reuse:

- [x] Compact the ten tab headers into a half-cell-width row with theme-controlled height and typography.
- [x] Use action cells' transparent face and feathered HUD backing, tinted blue rather than filled over an opaque well color.
- [x] Introduce an independent `--ui-spell-bar-color` plus documented backing, tab, typography, and drop-feedback overrides.
- [x] Share the actual snap-resize control with action bars. Spell shape switches between 1×10 and 2×5, preserving tab/cell addresses and remaining independent of stance visibility.
- [x] Verify both shapes, resize reversal, tab/binding preservation, theme independence from mana, transparent faces, shared feathering, live tab-height changes, and screenshots in the browser harness.

Geometry remains in the app's HUD layer. The bar measures theme dimensions and derives its natural extent; no arbitrary cell scaling or new casting policy is introduced.

Follow-up verification: type checks, ESLint, dead-code checks, all 2,439 TypeScript tests, build, and the full client HUD browser harness passed. The build retains its bundle-size advisory. Browser coverage caught layout handles overlapping the compact tab row; reserving that row above both handles resolved it, and all ten folded-layout tabs are now explicitly exercised. Both `/tmp/holtburger-spell-feedback.png.spell-bar.png` and `/tmp/holtburger-spell-feedback.png.spell-bar-double.png` were visually inspected.

### Final accumulated-diff code-quality review

Boundary: the complete frontend spell-bar feature against HEAD, including new files, action-bar changes, shared input and artwork consumers, browser fixtures, and theme documentation. Existing untracked files within ACE/ACViewer are unrelated and excluded.

- Resolved finding: the click-based shape operation retained drag-resize vocabulary. Renamed its component to `ShortcutBarShapeToggle`, updated accessible labels, CSS selectors, probe evidence, and current documentation. The button keeps its grid icon; actual drag-resize controls keep diagonal arrows. Removed resize threshold tuning and pointer-gesture machinery remain absent.
- Input seam: inspected configured exact modifier chords → `AppInput.spellBarCommand` → production game dispatcher, together with unchanged keyboard ownership and action-bar consumers. Focused scopes get first refusal; no additional keyboard boundary was added.
- Casting seam: inspected app activation → shared panel/bar cast callback → `ClientLifecycleSession.castSpell`. Spell identity and current selection reach the existing normal-aim request; session rejection reaches the existing warning toast. Backend routing is unchanged and was not re-audited.
- Binding/gesture seam: inspected fixed-address state helpers → cell DOM addresses → pointer owner → HUD mutation callbacks. Panel sources copy IDs; bound sources swap or clear only on completed valid releases. HUD composition owns the single Escape callback, item-interaction cancellation, visibility/tab cancellation, and mounted-owner teardown.
- Artwork seam: inspected reference loading → shared row preparation → consumer-owned display leases → icon display. The component retires stale requests and releases display ownership after DOM updates. Persistent spell-service leases have a separate justified lifetime. Binding identity survives unavailable knowledge and missing artwork.
- Layout/theme seam: inspected defaults → HUD placement → measured bar geometry → shared shape toggle and both callers. Theme values own cell/tab dimensions and backing colors; shape changes preserve cell addresses. No persistence or shared-crate policy was introduced.
- Maintenance exercise: traced tab switches during a pending load, character replacement, and live theme-size changes. Responsibilities stay within their current owners; no generic drag framework, casting abstraction, or duplicate input policy is needed. Separate item/spell gesture owners remain justified by item targeting, inventory preview, and consumable semantics absent from spell bindings.

Verdict: no remaining blocking code-quality findings in the reviewed frontend boundary. Most added machinery implements fixed binding state, gesture lifetime, display leases, and browser evidence; shared cell CSS, row preparation, and shape controls remove duplication. Verification is synthetic browser/session evidence, not a live-server combat test.

Final review validation: `check`, `lint:ts`, `lint:dead`, `format:check`, all 301 test files / 2,439 tests, `build`, and the full client HUD browser harness passed after the shape-toggle naming cleanup. Browser evidence is recorded under `/tmp/spell-review.png`; the build still emits its existing large-chunk advisory.
