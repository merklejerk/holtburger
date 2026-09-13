# Client selection ownership and tab targeting

Status: implemented and automatically verified. Visual feel and hands-on acceptance are user-owned, per the 2026-09-13 steering message.

## Goal and boundaries

Add predictable keyboard targeting to the 3D client through one selection owner and focused acquisition controllers, with no continuous candidate-processing work.

In scope: client gameplay bindings, selection ownership cleanup, semantic and spatial data needed for candidate acquisition, approximate camera filtering across EnvCells, stable cycling, contextual clearing, and automated/browser verification.

Out of scope: Explorer targeting UX, combat targeting or hostility preferences, changing server interest/retention, exact visibility or occlusion, rendering otherwise hidden targets, changing click-picking geometry, configurable bindings UI, and a generic controller/plugin framework. Do not run the TUI client or modify the retail decompile. The user authorized a final quality review and commit on 2026-09-13.

## Agreed behavior

| Input | Action |
| --- | --- |
| X | Select the local player directly. |
| Ctrl+Shift+Tab | Cycle non-creature world entities backward. |
| Tab | Cycle creatures forward. |
| Shift+Tab | Cycle creatures backward. |
| Ctrl+Tab | Cycle non-creature world entities forward. |
| Escape | Clear selection when gameplay receives an otherwise unconsumed cancel action. |
| Hold Tab / Shift+Tab for 500 ms | Acquire the nearest eligible creature once. |
| Hold Ctrl+Tab / Ctrl+Shift+Tab for 500 ms | Acquire the nearest eligible non-creature once, including behind the camera. |

- Creature targeting includes other players and friendly/hostile creatures; exclude the local player from cycling. Establish classification from authoritative properties, not names, appearance, or health-query eligibility.
- Use a tunable 50 m initial acquisition radius for both categories, measured in three dimensions from the player to the entity origin. Compare squared distances.
- Creatures must pass an approximate primary-camera view test. Non-creatures need no view test.
- Ignore walls, portal traversal, reached EnvCells, and draw visibility for the view test. Correctly resolve cell-based positions before testing them in a common coordinate frame.
- Exclude inventory/equipment and entities that authoritative selection rules hide. Do not include decorative renderer instances merely because they have geometry.
- Unknown classification or unresolved position cannot establish eligibility. Do not silently classify unknown entities as non-creatures.
- Cycle on short key release; eligible held chords instead acquire nearest once at the threshold and consume release. Ignore keyboard repeat. Match modifiers exactly so self-selection cannot also cycle a category.
- No candidates preserves the current selection. Leaving acquisition range/view does not itself clear selection.
- Existing contextual Escape consumers retain priority. A single consumed Escape must not also clear selection.

## Ground truth and existing boundaries

Read applicable AGENTS.md files before changing each subtree. The following paths establish current integration points; inspect their current contents during implementation rather than assuming this plan captures all APIs.

| Source | Evidence / purpose |
| --- | --- |
| `apps/holtburger-3d/src/client/client-entity-selection.ts` | Sole selected-GUID owner and maintenance; pointer queries and hover belong to the pointer controller. Direct `select()` invalidates an older pending click. |
| `apps/holtburger-3d/src/client/ClientApp.svelte` | Selection composition, consumers, gameplay input routing, and maintenance wiring. |
| `apps/holtburger-3d/src/client/client-viewport-pointer-gesture.ts` | Existing pointer gesture integration. |
| `apps/holtburger-3d/src/client/client-input-arbiter.ts` | Contextual cancellation and precise-jump behavior. |
| `apps/holtburger-3d/src/lib/input/{input-contract,input-defaults,keyboard-input-policy}.ts` | Semantic shortcuts, modifier matching, focus ownership, Tab handling. |
| `apps/holtburger-3d/src/client/{client-entity-mirror,client-host-contract}.ts` | Accepted semantic entity records and typed frontend boundary. |
| `crates/holtburger-world/src/entity_facts.rs` | Authoritative derived entity facts; extend here only for shared semantics. |
| `apps/holtburger-3d/host/src/client_projection.rs` | Narrow client wire projection. |
| `apps/holtburger-3d/src/client/client-presentation-session.ts` | Presentation ownership and camera reads. |
| `apps/holtburger-3d/src/lib/game/runtime/{dynamic-entity-feed,dynamic-entity-presentation,game-presentation-runtime}.ts` | Accepted movement data, coordinate conversion, realized presentation lookup. |
| `apps/holtburger-3d/src/client/client-selection-tracking.ts` | Existing camera-to-bounds retention distance; distinct from new player-to-origin acquisition distance. |
| `crates/holtburger-world/src/spatial/collision/selection_ray.rs` | Existing pointer broad phase rejects hidden entities and uses portal/collision tracing; do not reuse its query as Tab acquisition. |
| `crates/holtburger-core/src/client/selection_query.rs` | Existing asynchronous pointer-query orchestration. |
| `ACE/`, `ACViewer/`, `acclient-eor-source/` | Prove any uncertain classification, placement, or existing compatibility behavior from relevant definitions/call sites. Record exact references when used. |

Observed friction: the semantic mirror has identity facts but no complete targeting-position API. `selectedEntityPresentationState()` depends on realized objects and therefore cannot establish the full candidate population. Resolving an on-demand spatial read independent of realization is the first implementation milestone.

## North stars and concessions

- One selected identity; acquisition paths fan into its owner.
- Reuse accepted entity/motion data. Do not retain a second moving-world cache for targeting.
- Shared world owns semantic facts; the app owns camera policy, radius, bindings, ordering, and selection UX.
- Read geometry on demand. No frame loop, reactive candidate list, periodic sort, GPU readback, raycast, or portal walk for keyboard targeting.
- Approximate view filtering is intentional: use entity origins and an expanded camera view, not animated bounds. Large or edge-of-screen creatures may be imperfectly classified.
- Only known, placeable entities can qualify. This feature does not expand server interest or force asset realization.
- During a cycle, stable order takes priority over nearest-first ordering. New arrivals are immediately admitted at the end of the stable order.
- Keep changes proportional: two concrete acquisition controllers and a small selection owner; no controller base class, service registry, or generic event bus.

## Ownership and contracts

| Layer / proposed owner | Responsibility |
| --- | --- |
| `holtburger-world` | Creature classification, shared selection-admission facts, authoritative placement semantics. Compute each semantic decision once. |
| `holtburger-core` and app host | Existing orchestration and typed projection of necessary facts. No selected GUID or camera/cycle policy. |
| App presentation / existing motion owners | Narrow synchronous spatial reads using current accepted/presented poses and camera, independent of draw visibility. Coordinate conversion stays with the owner that knows the frame. |
| `ClientEntitySelection` | Selected GUID, notifications, lifecycle/identity validity, and acquisition supersession. |
| Proposed `ClientPointerSelectionController` | Pointer click/hover acquisition, pending query payloads, result refinement, hover notifications, and query failure behavior. |
| Proposed `ClientCycleSelectionController` | Active category, ordered GUIDs, cursor, last press time, membership refresh, approximate view policy, and cycle submission. |
| `ClientSelectionInput` and input routing | Semantic actions, one-shot hold timing, key release/modifier cancellation, and contextual precedence; acquisition controllers receive actions, not keyboard events. |

Inventory, minimap, self-selection, and clear remain direct actions. Keep their existing behavior, including inventory toggling, through the central owner.

The selection owner must arbitrate newer intent even when the chosen GUID is unchanged: use an owner-issued acquisition revision/token or an equally explicit small contract. An asynchronous pointer result may commit only while its intent is current. A keyboard/direct action invalidates older intent even if it finds no new candidate. Hover has independent pending state and must not invalidate selected-target intent.

Separate external selection from the cycle controller's own commits: external click/inventory/minimap/self/clear intent resets the cycle; its own commits do not. Explicit composition or a typed source contract is sufficient; do not infer this from whether the GUID changed.

## Cycle algorithm

Initial tuning lives in `client-tuning.ts` and its contract: acquisition radius 50 m, idle reset 300 ms, and a clearly named approximate-view margin. The initial margin is 2 m on each horizontal/vertical half-width; automated geometry checks cover it, while the user owns final visual tuning.

For each accepted cycle press:

1. Invalidate older selection acquisition intent and obtain a coherent current read of entity facts, player position, camera, and candidate positions. Pending/resync data does not authorize acquisition.
2. Build current eligible membership: semantic filters, squared player distance, then creature view test. Compute camera parameters once. Build candidate distance facts once for this press.
3. If category changed, no cycle exists, or elapsed idle time is at least the configured gap, sort all eligible candidates by distance then GUID.
4. Otherwise keep eligible survivors in their previous order and append newcomers sorted by distance then GUID. Re-entrants removed on a previous press count as newcomers. Idle sorting uses no timer; the separate input hold may fire once while a chord remains held.
5. Advance in the requested direction and wrap. On a fresh list, step from the current selected GUID if present; otherwise forward starts nearest and backward starts farthest.
6. During refresh, retain the cursor's logical gap when its GUID disappears: forward chooses the first surviving old successor, backward the first surviving old predecessor, respecting wrap. If no old member survives, treat the list as fresh. Do not reset to nearest merely because the cursor's entity disappeared. Appended newcomers participate in normal traversal.
7. Submit the chosen GUID and record the active cycle timestamp. Empty membership preserves selected identity and leaves an empty cycle ready to admit new candidates on the next press.

For creatures, use primary-camera side-plane/forward tests expanded by a tunable margin; the player-radius test owns distance clipping. Define the margin in named units and test the near-camera boundary explicitly. No equality comparison between player/camera/candidate EnvCell IDs is an eligibility test. Reuse math primitives, but do not substitute portal-clipped render views.

Cost: O(N + K log K) for a fresh list and O(N + K + A log A) for refresh, where N is known entities, K is eligible membership, and A is newcomers. There is no measured need for a spatial index. Verify actual candidate populations and keypress cost before considering one.

## Phase 1: Prove and expose candidate facts

- [x] Trace semantic classification and existing selection-admission rules through world facts and authoritative references. Record concrete definitions; do not repurpose `healthQuery` as creature classification.
- [x] Trace accepted pose storage/interpolation and identify a synchronous read that includes known entities outside reached/rendered EnvCells and without realized meshes.
- [x] Define a minimal typed on-demand candidate read. Keep positions branded and avoid retaining frame-hot values in Svelte state. Prefer sampling existing motion ownership rather than adding a new feed or cache.
- [x] Extend `entity_facts.rs`, projection, mirror schemas, and consumers only for facts missing from existing contracts. Cover snapshot/delta and resync behavior together.
- [x] Define handling of unplaceable, hidden, contained, attached, and unknown entities; reuse shared semantics where they already exist.
- [x] Add focused tests for classification/admission and coordinate resolution, including distinct EnvCells and an unrealized candidate.

Acceptance: a known eligible entity in an unreached EnvCell can supply identity and spatial facts without rendering or a per-keypress host query. Unknown/stale data cannot authorize a target. Existing contracts remain checked end to end.

## Phase 2: Separate selection from pointer acquisition

- [x] Extract pointer queries, refinement, and hover from `ClientEntitySelection` into the concrete pointer controller.
- [x] Keep selected identity, validity, lifecycle clearing, and acquisition revision ownership in `ClientEntitySelection`.
- [x] Wire direct actions and selected-target consumers through that owner; remove superseded pointer fields/methods after migrating callers.
- [x] Update pointer gesture and browser-harness integration; preserve existing click/hover behavior and current error reporting.
- [x] Test late pointer completion after keyboard/direct/clear intent, including unchanged GUID and no-candidate cases; test teardown and resync.

Acceptance: exactly one owner mutates selected identity; hover remains independent; old asynchronous selection results cannot overwrite newer intent. No duplicate legacy path remains.

## Steering checkpoint

- [x] Review the actual candidate data path and ownership against the requirements before implementing cycling.
- [x] Confirm no draw/asset/portal-residency dependency leaked into admission, and no second pose cache was introduced.
- [x] Record line-count impact and simplify any wrapper without a concrete consumer.
- [x] If existing motion feeds exclude otherwise known candidates, resolve that structural gap and revise Phase 1; do not silently weaken flattened-world behavior.

## Phase 3: Implement cycling and approximate view policy

- [x] Add the cycle controller and small pure membership/cursor/view helpers where useful; document the cursor-gap invariant.
- [x] Add radius, idle reset, and view-margin tuning with named consumers.
- [x] Implement the algorithm above, reading current facts on accepted keypresses and completed nearest-target holds.
- [x] Test fresh/reverse order, ties, wrap, single/empty membership, category switching, idle boundary, stable distance crossings, newcomers, removals around the cursor, re-entry, and external resets.
- [x] Test camera/player separation, squared 3D range, approximate view margins, behind-camera rejection, non-creature rear admission, and cross-cell candidates.
- [x] Use test-owned tuning inputs; integration tests import runtime tuning instead of copying its numeric values.

Acceptance: newcomers become reachable on the next press; old survivors never reorder during an active cycle; changed distance cannot trap traversal among a subset of stable eligible candidates. No recurring work is scheduled; a held Tab/Ctrl+Tab has one nearest-acquisition threshold callback.

## Phase 4: Wire client input and lifecycle

- [x] Extend semantic input contracts/defaults with exact-modifier bindings for the agreed actions.
- [x] Compose both controllers with the existing selection owner in `ClientApp.svelte`; keep frame-hot reads imperative.
- [x] Route self-selection and clear through the same owner and reset cycling on external selection intent.
- [x] Preserve chat/modal/precise-jump Escape priority and browser focus ownership. Ignore repeat and composing input.
- [x] Reset controller state on world/session replacement and teardown; stale pre-resync membership must not survive recovery.
- [x] Preserve current selection retention behavior while explicitly distinguishing camera-to-bounds retention distance from player-to-origin acquisition distance. Do not change retention policy as an incidental refactor.

Acceptance: all six binding forms perform exactly their intended action; UI focus/cancel consumers win correctly; existing pointer, inventory, minimap, health/target UI, outline, and interaction consumers share the same selected GUID.

## Phase 5: Browser verification and cleanup

- [x] Extend the canonical noninteractive browser harness with synthetic entities/camera/accepted movement that exercise production input and selection composition.
- [x] Verify two creatures exchanging distance, a newcomer entering view, cursor removal, reverse traversal, rapid category changes, Escape priority, and a late click response.
- [x] Verify a creature in a distinct unreached EnvCell qualifies geometrically without requiring visible rendering, and a rear non-creature qualifies while a rear creature does not.
- [x] Assert selected GUID independently of screenshots: a through-wall or unrealized selection need not produce a visible outline.
- [x] Capture candidate counts and representative keypress durations; confirm idle frames do not scan/sort candidates. Keep diagnostic instrumentation in the harness, not permanent product metrics.
- [x] Remove dead APIs, vocabulary, brittle tests, and temporary runtime-asset-dependent tests. Keep professional comments for new contracts and non-obvious cursor behavior.
- [x] Review the final diff for ownership, honest types, unnecessary state, and line-count growth. Resolve warnings rather than suppressing them.

Verification commands from `apps/holtburger-3d`: `npm run test:ts -- <affected test paths>`, `npm run check`, `npm run lint:ts`, `npm run lint:dead`, and `npm run harness:browser -- <fixture options established above>`. Run `npm run check:rust` and `npm run lint:rust` if host/shared Rust changes; also run focused tests and clippy with `-D warnings` for each changed shared crate. Run applicable repository formatting checks. Do not rerun broad checks without a change or unresolved failure that justifies it.

Acceptance: focused logic tests, actual browser integration, applicable type/lint/format checks, and changed Rust crate checks pass. Record commands and evidence in this plan during execution.

## Risks and decisions

| Risk | Mitigation |
| --- | --- |
| Candidate geometry only exists after realization | Sample accepted motion/placement ownership; verify an unrealized candidate before building cycling. |
| Incorrect cross-cell coordinates | Reuse owner-produced coordinate conversion and branded contracts; test differing cells/landblocks. |
| Refresh removes the cursor and skips/repeats targets | Preserve its logical gap explicitly; test removal in both directions and wrap. |
| A newer action chooses the same GUID | Supersession is intent-based, independent of selected-GUID notifications. |
| Long continuous cycling is no longer nearest-first | Intentional stable-order concession; short idle reset restores nearest-first ordering. |
| Approximate view excludes large visible bodies | Accepted origin-based approximation; tune an explicit margin without introducing mesh dependency. |
| Ctrl+Tab intercepted by application shell | Verify actual input delivery in the desktop shell if browser tests cannot establish it; adjust shell routing, not the agreed binding, if necessary. |

No blocking user decisions remain. The exact view margin is implementation tuning. Exact semantic classification and the non-realization-dependent pose read are evidence tasks, not permission gates. If either requires a materially different architecture or weaker behavior, document the finding and revisit that boundary before proceeding.

## Definition of done

- [x] Agreed bindings and contextual Escape work through one selection owner.
- [x] All creature dispositions qualify; self has its own action.
- [x] Approximate view filtering crosses EnvCells and ignores walls/portal rendering.
- [x] Membership refreshes on every press while survivor order stays stable.
- [x] No per-frame targeting scan, sorting timer, extra moving-world cache, or required per-keypress host round trip exists.
- [x] Selection retention and existing acquisition/interaction consumers remain coherent.
- [x] Tests and browser evidence cover the meaningful invariants; required checks pass.
- [x] Cleanup is complete and implementation decisions/evidence are recorded.


## Implementation decisions and evidence (2026-09-13)

- `ClientEntitySelection` remains the sole selected-GUID owner. `ClientPointerSelectionController` owns click/hover queries and `ClientCycleSelectionController` owns keyboard traversal. Intent tokens invalidate stale click completions independently of GUID changes; recovery/replacement snapshots reset cycle intent.
- `EntityTargetingCategory` is produced in `holtburger-world/src/entity_facts.rs`. It distinguishes eligible creatures, eligible non-creatures, and ineligible identities. Public creature classification is computed once and shared with existing health eligibility. Authoritative references: `ACE/Source/ACE.Entity/Enum/ItemType.cs:13`, `ACE/Source/ACE.Server/WorldObjects/WorldObject_Properties.cs:1787`, and `crates/holtburger-world/src/hydration.rs:61` (wire UI-hidden flag hydration). Independent placement and accepted storage relationships determine world-target admission.
- Existing core entity-fact publication and host serde projection already transport the full record. The frontend schema and fixtures were updated; no new host command or parallel semantic publication path was needed. Core publication tests prove snapshot/delta reconstruction still agrees.
- Candidate positions use the existing dynamic mirror's latest accepted root poses consistently, including movement updates. `project_client_dynamic_entities` in `crates/holtburger-core/src/client/dynamic_entity_view.rs` enumerates representable entities without camera portal traversal; the browser mirror receives accepted records before renderer realization. Fully unhydrated/unprojectable entities remain outside acquisition, as permitted by the known/placeable concession.
- Accepted poses can differ slightly from interpolated drawn poses. This is an explicit application of the approximate-view concession. No extra interpolation state, moving-entity cache, asset realization, or geometry envelope was introduced.
- `dynamicEntityWorldOrigin` performs the existing AC-to-canonical-scene coordinate conversion without requiring EnvCell topology. Tests cover different EnvCells and crossing an outdoor landblock coordinate boundary. The primary camera read never exposes portal-clipped views.
- Approximate view policy uses a 2 m side margin and rejects negative camera depth. Candidate work occurs on short key release or once at a completed hold threshold. The radius starts at 50 m and idle gap at 300 ms, all under `CLIENT_TUNING.entitySelection.cycle`.
- The code-quality pass removed the unused selection token from hover queries, reset traversal on replacement snapshots, and checked that acquisition/retention distances remain separate. Production-file net growth is 545 physical lines, including Rust unit tests in `entity_facts.rs`; this includes the new cycle algorithm, acquisition separation, input integration, geometry reads, and semantic contract. No registry, base controller, polling scheduler, spatial index, or reactive candidate state was added. The later hold revision adds one cancellable input timer.
- Electron's inspected `before-input-event` handler only intercepts Ctrl+Shift+I; application menus are disabled. Real desktop chord delivery and visual feel remain on the user's acceptance checklist rather than being claimed from synthetic browser keyboard events.

### Automated verification

The following records describe verification at earlier implementation milestones. The final review below records checks after the binding and timing revisions.

| Check | Evidence |
| --- | --- |
| `npm run test:ts -- src/client src/lib/input src/lib/game/runtime/dynamic-entity-feed.test.ts src/lib/game/runtime/dynamic-entity-presentation.test.ts` | 27 files, 222 tests passed. Covers existing client behavior, input, feed updates, and selection integration. |
| `npm run test:ts -- src/client/client-cycle-selection-controller.test.ts src/client/client-entity-selection.test.ts` | Final focused rerun: 28 tests passed after adding tie and landblock-boundary cases and removing the unused hover token. |
| `npm run check` | Svelte: zero errors/warnings; app, test, node, and Electron TypeScript checks passed. |
| `npm run lint:ts` and `npm run lint:dead` | ESLint and Knip passed. |
| `cargo test -p holtburger-world entity_facts --lib` | Six world-fact tests passed, including category/hidden/independent-placement behavior. |
| `cargo test -p holtburger-core entity_facts --lib` | Eight publication tests passed, including snapshot/delta equivalence and unchanged semantics on movement. |
| `cargo check -p holtburger-3d-host` | Host and changed shared contract compile together. |
| `cargo clippy -p holtburger-world -p holtburger-3d-host --all-targets -- -D warnings` | Passed with warnings denied. |
| `cargo fmt -p holtburger-world -- --check` and Prettier checks on changed frontend files | Formatting verified. |
| `npm run harness:browser -- --client-hud --brief` | Final run exited 0; production keyboard policy, both acquisition controllers, semantic/dynamic mirrors, and existing HUD/inventory/theme checks passed. Targeting uses asset-free accepted entities in a different unreached EnvCell, without a renderer. |

The targeting browser probe verifies distance crossing, immediate newcomers, forward/reverse traversal, cursor removal, category switching, self-selection, rear non-creatures, late click completion (including an empty cycle), precise-jump/editor/gameplay Escape priority, and no candidate scans over three idle animation frames. Unit checks additionally cover repeat/composition/modifier rejection, range and camera margins, empty/single lists, ties, idle expiry, re-entry, recovery, unchanged-GUID supersession, and teardown.

The browser workload used 1,000 synthetic eligible creatures and 20 keypress samples: median 0.4 ms, observed range 0.2–1.4 ms for dispatch plus acquisition on this machine. This is synthetic input-path evidence, not a live population census or renderer benchmark. The report exposes the workload and samples under `clientTargeting`; no production performance metrics were added.

The harness initially needed sandbox escalation because loopback binding returned `EPERM`. One run was invalidated by source HMR during later inventory checks. A subsequent run exposed a harness report-placement mistake: a non-HUD report had entered a collection of HUD snapshots. Both were resolved; the final stable-source run passed. Expected injected missing-icon warnings belong to the existing inventory diagnostics.

### User-owned visual and interactive acceptance

The user explicitly took ownership of these gates; they are not remaining agent implementation work.

- [ ] Try Tab/Shift+Tab among moving creatures; check that rapid cycling remains predictable and newcomers are reachable.
- [ ] Turn toward another room/group and verify the approximate cross-EnvCell view policy feels right. Walls intentionally do not block acquisition.
- [ ] Try Ctrl+Tab for rear objects, Ctrl+Shift+Tab for reverse object cycling, X for self, and contextual Escape in gameplay, chat, dialogs, and precise-jump mode in the desktop app.
- [ ] Assess the 50 m radius, 300 ms idle gap, and 2 m view margin; adjust `client-tuning.ts` as desired.

Binding revision: X now selects self; Ctrl+Shift+Tab cycles non-creatures backward. Updated input routing, focused binding tests, and browser probe accordingly. The revision passed 19 focused tests, `npm run check`, and `npm run lint:ts`; the browser probe was updated but not rerun for this binding-only revision. Interactive acceptance remains user-owned.


### Hold behavior

- `ClientSelectionInput` now owns the keyboard gesture lifetime. Short presses cycle on release; holding Tab acquires the nearest creature and holding Ctrl+Tab acquires the nearest non-creature once after `CLIENT_TUNING.entitySelection.holdDelayMs` (500 ms).
- `ClientCycleSelectionController.selectNearest` samples current eligibility, chooses the minimum distance with GUID tie-breaking in one pass, and resets the stable cycle. It preserves selection when no eligible target exists. It uses the same radius and category-specific view rules as cycling.
- Releasing early, changing modifiers, losing focus/context, starting precise-jump mode, newer external selection intent, recovery, and teardown cancel the pending hold. All four Tab chords arm nearest acquisition in their cycling category. Auto-repeat never restarts or repeats the timer.
- The input object replaces the former stateless keydown helper; there is no second routing path. The timer lives in the app input layer, not in world state or the candidate sampler.
- Focused fake-clock tests cover threshold timing, current positions, one-shot behavior, cancellation, short-press behavior, empty candidates, ties, and stale ordering. The browser probe now exercises all four holds and real focus cancellation.
- User acceptance: try holding each chord for 500 ms. Selection stays unchanged until short release or the nearest-acquisition threshold; assess that feel along with the existing range/view-margin tuning.

Hold revision verification passed: 40 focused tests across input/cycling/selection; `npm run check`; `npm run lint:ts`; `npm run lint:dead`; and the full `npm run harness:browser -- --client-hud --brief` run. The browser report confirms `holdDelayMs: 1000`, both hold/focus checks, and zero scans during three idle frames.


### Tap-on-release correction

All four cycling chords now defer their cycle action until keyup. All four Tab chords are mutually exclusive tap/hold gestures: no selection or candidate scan occurs on keydown, short release cycles once, and reaching the hold threshold acquires nearest once and consumes release. Shift changes short-press direction only; holding either direction selects nearest. X and Escape remain immediate direct actions.

Pending press state captures the category, short-press direction, start time, and one-shot timer. New intent still invalidates older asynchronous clicks at keydown. Focus/context loss, modifier changes, newer selection, recovery, and teardown cancel both release and hold actions. Release timestamps also recognize an elapsed hold if the event loop has not yet dispatched its timer. Cycle idle ordering uses the release timestamp.

Tap-on-release verification: 44 focused tests passed, along with type checks, ESLint, Knip, formatting, and the full browser harness. Browser hold assertions now explicitly require unchanged selection before the threshold; focus cancellation leaves the pre-press selection intact.

Hold binding correction: per the latest request, Ctrl+Tab now holds for nearest non-creature; Shift+Tab also holds for nearest creature, and Ctrl+Shift+Tab holds for nearest non-creature. Tab continues to hold for nearest creature.

The Ctrl+Tab hold correction passed 31 focused tests, type checks, and ESLint. Browser fixture expectations were updated; this mapping-only correction was not rerun through the full browser harness.


### Final code-quality review

Reviewed the accumulated feature against HEAD, including untracked controllers, input policy, tests, and harness code. The unrelated untracked contents inside ACE and ACViewer are excluded from the commit.

Seams inspected: world classification and placement resolution; core snapshot/delta publication and dynamic projection; host forwarding; frontend schema and lifecycle snapshot/delta commit; accepted-pose conversion and primary-camera sampling; selection intent arbitration; pointer request/result refinement; ClientApp keyboard, focus, precise-jump, direct-selection, and teardown wiring. Existing interaction and inventory callers continue to use the single selection owner.

No blocking production design findings. The concrete controllers have distinct lifetimes and responsibilities; the temporary candidate map is local to acquisition and introduces no invalidation duty. Approximate origin-based view filtering and latest accepted rather than interpolated poses remain deliberate concessions. Future tuning changes are confined to client tuning; adding another acquisition source uses selection intent tokens without owning another selected GUID.

Fixed fixture contracts that marked contained inventory items as eligible non-creatures, removed unused per-keydown timing storage from the harness, and corrected stale documentation about hold timing and optional hold actions. The retained benchmark measures complete keydown/keyup acquisition. No production diagnostics or speculative abstractions were added. Desktop shortcut interception, live-world visual feel, and interactive acceptance remain user-owned and are not established by synthetic browser events.

Final review validation: 78 focused frontend tests, six world-fact tests, type checks, ESLint, and Knip passed. After fixture corrections, the 19 affected interaction/mirror/inventory tests passed. The full browser harness exited 0 with targeting passed, holdDelayMs 500, all four hold checks, focus cancellation, and no scans across three idle frames. Earlier Rust host/Clippy checks remain applicable because this review changed no Rust code.
