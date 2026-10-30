# Compact Locks UX working notes

The Locks flow is h3d policy. World owns tool facts and success estimates; core admits and
completes individual guarded uses. No shared crate owns a chooser or automatic key sequence.

## Actions and subject

- The title identifies the currently selected locked subject: `Unlock <target name>`.
- Manual mode offers `Try all N keys`, where N is the number of distinct usable key templates.
  The same WCID deduplication and fresh candidate validation apply to automatic mode.
- The other action is `Lockpick`, with its estimate when known and one preferred item cell.
  Single-click anywhere on the button attempts that pick; right-click on its cell examines it.
- Picks rank by additive template bonus descending, then known remaining uses ascending,
  then stable name/identity. Unknown bonuses use the agreed zero assumption; unknown uses go last.
- Preference and chance update automatically when a pick is consumed, inventory changes its
  ranking, the character's skill changes, or the target appraisal arrives. There is no manual
  pick-selection state and no automatic lockpick retry.
- Hide unavailable actions; no eligible action means no window. Picking requires trained or
  specialized Lockpick and an owned, usable, non-exhausted pick.
- The visible window follows the currently selected locked entity; selecting an ineligible
  entity or clearing selection closes it. Selection changes cancel the current sequence and
  never redirect its submitted attempt or automatically start a replacement sequence.
- Inspection uses an explicit identity without changing gameplay selection. The Examine
  shortcut continues to inspect the current selection.

## Automatic keys

`lockInteractions.autoUseKeys` is a local Gameplay preference, default on. A saved opt-out stays
off. The policy is captured for each locked encounter.

Enabled runs distinct key attempts without opening a window, displaying existing progress
toasts and binding the Escape stack. Known remaining uses sort ascending both within duplicate
key groups and across groups; unknown counts follow known counts. Only exhaustion by wrong-key
receipts opens the preferred-pick chooser. Already-tried keys remain hidden in that fallback.
No usable keys goes directly to eligible lockpicking. Disabled opens the compact manual actions.

Selection changes, movement, Escape, dismissal, timeouts, aborts, busy/error rejection, target removal, lost queued
inventory, and exhausted compatibility candidates stop without opening a fallback window.
Cancellation cannot retract an already submitted action. Its correlated receipt remains owned.
A duplicate locked notification cannot restart pending automatic work.

An authoritative `Locked=false` update produces the existing success toast and closes the
matching window. Automatic key success also posts one local system-chat line naming the key and
target. Submitted attribution survives consumption, cancellation, and a receipt preceding the
unlock property. Manual tools and lockpicks do not add this automatic-key notification.

## Selection and inspection ownership

`ClientEntitySelection` remains the sole gameplay selection owner. The h3d Locks owner
subscribes directly to identity changes and only accepts locked feedback for the current
selection. Visible controls retarget to another known locked selection, refreshing target
appraisal and the preferred-pick estimate. Hidden automatic work stops without opening a
window. Delayed locked feedback for an old selection is ignored.

Submitted uses and unlock/chat attribution retain their captured identity through cancellation.
A new subject cannot submit while the old use still owns its terminal receipt. No separate
locks marker or frontend targeting identity is presented.

The inspector already owns its own explicit subject. HUD, Nearby, and viewport right-clicks
inspect that identity without selecting it. Left-click selection, keyboard Examine, and normal
combat selection policy remain with their existing frontend owners. Nearby validates sampled
rows against fresh catalog facts before inspecting. Viewport examination reuses the existing
non-selecting pointer acquisition primitive, including correlated asynchronous results.

## Static bonuses and estimates

`holtburger-content::lockpick_bonus` supplies the ten verified standard WCID defaults for
integer LockpickMod (88). World supplies the same `LockToolFacts` to inventory and inspections.
Unknown WCIDs remain unknown in inspectors and assume +0 for ranking and estimates. There is
no live template catalog dependency, metadata bootstrap index, or catalog format expansion.
The ten local ACE pick templates all use multiplier 1. Normal appraisal does not disclose
LockpickMod, so no tool appraisal queue is used.

The chooser requests one background target appraisal per opening through the existing broker.
World estimates from current Lockpick skill, authored pick bonus, and the last appraised effective
lock resistance using ACE's skill-check curve. Missing difficulty/skill yields no estimate;
unpickable resistance yields zero. Server or per-instance template overrides remain unknowable.

WCID equivalence cannot prove hidden key-code equality. The server does not tag UseDone with
client sequence IDs, so the existing late-receipt attribution limitation remains.

## Branch update and validation

Fast-forwarded from 9d23a8aa4 to 534a30c4f, bringing in the four local 3d-next commits. Resolved
three core overlaps while retaining both guarded-use receipts and spell-bearing item recipients
for the new combat indicator. A recovery stash and separate /tmp patch/archive were retained.
All feature work stays unstaged and uncommitted.

Validation covers compact actions, preference replacement, stale estimates, key deduplication,
use ordering, automatic/manual policy, interruption, unlock/chat receipt orderings, selection
cancellation, non-selecting inspection, and merged guarded spell-item publication. Visual
acceptance remains with the user; no live inventory consumption is used for diagnostics.

Completed validation: 4,124 frontend tests; 780 core, 1,030 world (three existing ignored), and
398 host tests; 11 compact Locks browser checks including target-overlay coexistence and
teardown; and the upstream combat-bar and combat-Escape browser probes. Final preferred-view
cleanup passed its 29 focused workflow tests, type checks, ESLint, and a repeat browser/build
run. Clippy with warnings denied, formatting, unused-code checks, and production CSS-layer
checks passed. No screenshots or live inventory consumption were used. A preservation audit
confirmed 48 unrelated modified files are byte-identical to the pre-update stash. The branch
matches local 3d-next and the index remains empty.

## Action layout

The chooser has horizontal actions with captions beneath. Keys use a bespoke monoline
key-ring SVG. The preferred pick itself is centered in its action at the shared normal
inventory-cell size; there is no separate lockpick action icon. The one native button owns
all left-click activation, and the embedded item visual owns no independent button. Right-click
on the cell examines it without changing selection. Second clicks in a double-click do not
submit additional attempts. Status, progress, cancellation, and skip feedback use toasts.

The cell reuses shared artwork, quantity/uses overlays, and cooldown rendering. Browser checks
verify fixed normal dimensions, centering, captions, single-click activation, examination,
double-click behavior, and selection-driven cancellation and retargeting.

## Selection cutover validation

All 4,131 frontend tests passed. Focused final workflow/projection checks passed
91 tests after removing the secondary-marker path. Locks and Nearby browser
probes passed selection-cancellation, retargeting, and non-selecting examination
checks. The inspection browser suite passed real viewport, inventory, and action-cell
right-clicks with selection preserved. Its fixture required the current gameplay
preferences and lock-tool fields; its XP assertion now reads exact quantity
tooltips instead of mixing visible compact text with screen-reader text.

Type checks, ESLint, unused-code checks, formatting, build, and CSS-layer validation
passed. Inspection's container preflight had one intermittent source-presence
assertion failure; subsequent runs passed, and its failure diagnostic now names the
request/source. No product change was made for that unproven intermittent failure.

## Fixed unlock window

Unlock uses the default width and natural content height regardless of previously saved user
resize dimensions. Position remains movable and persisted. The floating window
shell exposes an optional resize switch (default enabled); Unlock disables it.
Both action captions stay on one line, including `Lockpick · 100%`. The floating
window shell measures its natural outer height for placement, preserving viewport
clamping without reserving unused space below the actions.

## Unlock helper UI preference

UI / Display has a single `Use unlock helper` checkbox, without explanatory text.
`ui.useUnlockHelper` defaults to true, including older profiles. Explicit false
is persisted. It gates both the window and automatic key attempts; the separate
automatic-key preference is retained. Disabling closes the window and cancels
future attempts immediately; submitted attempts retain their receipts. Enabling
does not resume cancelled work; a new locked interaction starts the helper.

## 3d-next detection integration

Rebased onto c14355ad1. Retained upstream public entity classification, DAT housing-storage
identity, and Explorer-only catalog ownership. Removed the helper's catalog format/export and
runtime metadata-index changes; restored the local v11 snapshot from its backup.

Core preserves immediate generic feedback for ordinary direct uses. Guarded direct uses emit
structured Locked feedback with target/name and the original receipt sequence. The helper
waits for that exact receipt before starting automatic keys; manual actions stay disabled until
it completes. Aborts, timeout, errors, movement, Escape, selection, disappearance, and opt-out
cancel the wait without fallback. Repeated broadcasts cannot revive the same opening.
Core's existing receipt ownership supplies correlation; h3d retains all sequence/UX policy.
The broadcast still has no actor/request identity, so concurrent users and custom housing
storage identities retain upstream's documented best-effort limitation. Wire UseDone itself
still lacks a request ID; local sequence IDs do not remove that protocol limitation.

Integration validation: 4,146 frontend tests; 2,373 Rust library tests (3 existing ignored);
50 focused Locks workflow tests after final cleanup; unlock, inventory, and Nearby browser
probes with no browser errors; Svelte/TypeScript checks, ESLint, Knip, formatting, and
Clippy across content/world/core/host/CLI all passed. No visual acceptance was performed.
The rebase recovery stash and /tmp patch/untracked archive remain available; index is empty.

## Final code-quality review

Verdict: ready within the reviewed feature scope after the fixes below. Baseline was c14355ad1;
the audit included the accumulated tracked diff, new files, callers, tests, and documentation.
The unused item-grid double-click API and incidental combat-presentation edit were removed
rather than carried into the feature commit.

Confirmed findings addressed:

- Cancelled opening uses previously discarded their receipt identity while core still owned
  admission. The helper now retains a cancelled opening until its exact terminal receipt.
  Retargeted manual actions remain disabled until that receipt; cancellation cannot queue a
  continuation or a fallback. Regression tests reproduced the original premature admission.
- Manual opening waits bypassed inventory/skill presentation reconciliation. Visible manual
  controls now refresh preferred-pick estimates and eligibility during that wait. A regression
  test reproduced the stale source query when the preferred pick changed.
- Dispatch accepted an intent and an independently constructed PendingOperation. Core now
  derives busy ownership, spell target, and receipt correlation from the same dispatched intent
  and optional receipt sequence. Existing guarded/ordinary, spell-item, send-failure, and
  container-roster tests cover its consumers.
- Queue mode, remaining groups, and progress counters had separate reset obligations. One
  KeyRun owns their lifetime now. Removed the redundant per-attempt batch flag; cancelled
  progress has no remaining consumer. Corrected a late-unlock fixture to retire the old use
  before admitting a newer direct interaction, matching core's actual admission guarantee.

Seam coverage:

- Content bonus lookup -> world tool facts -> inventory and item-inspection projections ->
  strict frontend decoders, ranking, inspector bonus, and preferred-cell presentation.
- Target appraisal broker and current skill -> world success estimate -> considered-target
  query/result -> host projection/stdio -> transport/session -> stale-query filtering and HUD.
- Guarded dispatch -> sound correlation and typed lock feedback -> host/session -> original-use
  wait -> key compatibility checks -> individual submissions -> resolved completion/abort/timeout.
  Also inspected direct container-roster admission and spell-bearing item recipient retention.
- Selection notifications, movement/tool acquisition callbacks, Escape ownership, UI opt-out,
  resync, late unlock facts, and automatic chat attribution through their actual app callers.
- Settings defaults/schema/section persistence -> UI and Gameplay controls -> helper policy;
  retained HUD sizing/placement and item/icon resource lifetimes through their immediate callers.
- Viewport non-selecting acquisition, explicit HUD examination, Nearby fresh-row admission,
  and Salvage/Vendor secondary actions through the inspection owner and browser probes.

Keep the normal combine controller and helper workflow separate: they have different intent
and cancellation lifetimes, but share guarded dispatch and sequence allocation. Keep the last
submitted unlock watch separate from the pending receipt: unlock properties may arrive after
UseDone, consumption, or cancellation. No new generic orchestration framework is justified.

Accepted concessions remain standard WCID bonus estimates (unknown assumes zero), WCID key
rather than hidden-code equivalence, sound broadcasts without actor/request identity, and
UseDone without a wire request ID. The audit does not claim verification of live-server custom
content, unchanged transport/renderer internals, or visual acceptance. No TUI runtime was run.

Final verification: 4,148 frontend tests, 2,373 Rust library tests (3 existing ignored), focused
workflow/startup regressions, unlock and actual-pointer inspection browser probes, Svelte and
TypeScript checks, ESLint, Knip, formatting, and Clippy passed. The first parallel frontend run
hit its startup-import timeout; the focused run and full rerun without the competing browser
and Rust workloads both passed without changing its timeout or test implementation.
