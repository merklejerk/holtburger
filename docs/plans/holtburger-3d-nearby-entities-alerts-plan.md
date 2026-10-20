# Holtburger 3D Nearby Entities and Alerts Plan

Status: **Implemented. Verification and completion evidence are recorded below.**

This records the initial implementation. Subsequent user-directed refinements
supersede the first-seen sorting, direct-use details, immediate rule-edit
announcements, and cache-only encounter membership described below. The final
UI uses compact category/location details and exact-name bell toggles, edits
rules silently through a panel dialog, and rearms encounters after confirmed
scene-interest departures. Dedicated icons and shared catalog/filter styling
expose theme hooks, including cached CSS-driven minimap rings.

Created: 2026-10-19

## Goal and boundaries

Give Client mode one nearby-entity catalog with fuzzy search, category pills,
selection, expandable public facts, persistent name alerts, chat detections,
and minimap tracking decoration.

This is primarily a TypeScript feature in `apps/holtburger-3d/src/client/`.
Small Rust changes are permitted where the public fact contract or shared
classification needs improvement. Do not introduce a shared Rust alert engine.

### Agreed scope

- A button attached to the minimap opens a movable, resizable, retained HUD
  window named Nearby with Entities and Alerts tabs.
- Flat entity rows; no wielded-equipment tree or container-content hierarchy.
- Fuzzy name search consistent with the spell catalog.
- Category pills: Monsters, NPCs, Players, Containers, Items, Portals,
  Lifestones, Doors & Switches. Tracked is a separate narrowing filter.
- NPCs includes vendors; Containers includes corpses; Items includes
  miscellaneous entities. Retain useful subtype distinctions in details.
- Distance, name, category, and first-seen sorting.
- Clicking a name selects the entity through the existing selection owner.
  A separate disclosure expands its information without changing selection.
- Details use ordinary public entity creation/update facts, accepted world
  placement, and local observation metadata only. Appraisal-derived facts are
  excluded even if already cached.
- Add an exact-name alert from an entity row. Manage case-insensitive name
  globs in Alerts, with independent tracking of every matching entity.
- Print detections and their captured initial coordinates in local chat.
- Decorate matching eligible minimap blips without replacing category colors
  or selected-target styling.
- Alerts continue while the window is closed.

### Excluded

- Inspection/appraisal requests or inspection-derived fields, including level,
  detailed vitals, lock information, value, and appraised portal destination.
- Equipment trees, inventory/contained items as nearby roots, or carried-item alerts.
- Static DAT scenery discovery or entities the server has not disclosed.
- Sounds, historical sighting archives, advanced rule predicates, and a general
  notification framework.
- New minimap visibility exceptions: tracking decorates existing eligible blips.
- TUI changes, staging, or commits.

### Proposed defaults carried into implementation

These were proposed in scoping and should remain explicit rather than becoming
accidental behavior: per-character persisted rules; exact whole-name matching
unless globs are used; announcing current matches when enabling a rule; batching
bursts; and a short absence grace period before rearming. Revisit if evidence or
user steering changes them. Timing values belong in named app tuning constants.

## Ground truth and existing patterns

Read these owners and their immediate consumers before editing:

| Responsibility | Reference |
| --- | --- |
| Public identity, storage, availability and use facts | `crates/holtburger-world/src/entity_facts.rs` |
| Shared semantic categories | `crates/holtburger-world/src/entity_classification.rs` |
| Accepted browser entity facts | `apps/holtburger-3d/src/client/client-entity-mirror.ts` |
| Semantic and dynamic publication / recovery | `apps/holtburger-3d/src/client/client-lifecycle-session.ts` |
| Accepted pose feed | `apps/holtburger-3d/src/lib/game/runtime/dynamic-entity-feed.ts` and `dynamic-entity-session.ts` |
| World pose distance precedent | `apps/holtburger-3d/src/client/client-entity-distance.ts` |
| Selection admission and retention | `apps/holtburger-3d/src/client/client-entity-selection.ts` |
| Composition and chat append | `apps/holtburger-3d/src/client/ClientApp.svelte` |
| HUD assembly and minimap mounting | `apps/holtburger-3d/src/client/ClientWorldView.svelte` |
| Window/tab primitives | `ClientHudWindow.svelte`, `src/app/UiTabs.svelte`, `src/app/UiTabPanel.svelte`, `src/app/ui-base.css` |
| Search and disclosure precedent | `ClientSpellsPanel.svelte`, `client-spell-search.ts`, `src/app/text-search.ts` |
| HUD geometry and defaults | `client-hud-layout.ts`, `client-settings-contract.ts`, `client-settings-defaults.ts` |
| Character persistence | `client-character-settings-owner.ts`, `client-settings-sections.ts`, `client-settings-transport.ts`, `electron/client-settings-store.ts` |
| Chat formatting and coordinates | `client-chat-policy.ts`, `ClientChatFormattedText.svelte`, `ClientWaypointText.svelte` |
| Map frame and blip drawing | `src/app/minimap-frame.ts`, `src/app/Minimap.svelte`, `src/lib/game/map/map-blips.ts` |
| Narrow host projection | `apps/holtburger-3d/host/src/client_projection.rs` |
| TUI reference only | `apps/holtburger-cli/src/pages/game/panels/dashboard/tabs/nearby/` and adjacent `classification.rs` |

Paths without a crate/app prefix in this table are relative to
`apps/holtburger-3d/src/client/` unless explicitly prefixed with `src/` or `electron/`.

Important evidence:

- The world classifier gives players and vendors priority, then uses public
  creature/attackable facts to distinguish Mob and NPC. This is not a verdict
  that something will attack the local player.
- ACE aggression also uses tolerance, factions, and retaliation:
  `ACE/Source/ACE.Server/WorldObjects/Monster_Awareness.cs`.
- `ACE/Source/ACE.Server/WorldObjects/Player.cs::OnAppraisal` can wake a creature
  with appraisal-triggered aggression. Catalog actions must not appraise.
- Current semantic and dynamic updates can arrive separately. Detection must
  join accepted identity and pose evidence without depending on arrival order.
- Semantic mirrors can become pending during recovery. Pending is not removal.
- Existing map policy suppresses some blips. A catalog match does not guarantee
  a marker; this scope preserves that policy.

Use ACE as protocol/server ground truth and the retail decompile where needed
for client interpretation. Do not modify the retail decompile. New retail
behavior exceptions require the repository's evidence and census convention.

## Design principles

1. Keep one session-owned nearby feature owner, independent of panel mounting.
2. Borrow accepted world data; do not create another mutable copy of the world.
3. Derive authoritative semantic decisions once in world contracts. Frontend
   grouping and presentation stay in h3d.
4. Treat each entity identity independently, even when names are identical.
5. Keep search, glob matching, and detection lifecycle as small pure policies
   wherever possible; do not build an extensible rules framework.
6. No producer-rate entity payloads in Svelte reactive state. Publish bounded
   display snapshots for the visible panel; minimap consumers pull imperative state.
7. Unknown facts stay unknown. Asset readiness and appraisal cannot change
   catalog eligibility or provide richer catalog facts.

## Ownership and contracts

```text
Rust world: public classification, relationships, accepted placement semantics
    -> existing typed host/session facts and dynamic poses
    -> ClientNearby (TypeScript; created/disposed by ClientApp per session)
         -> visible panel display snapshots
         -> detection batches -> existing local chat append
         -> tracked GUID snapshot -> existing minimap frame/draw path

existing character settings owner <-> persisted alert rules
panel local state: query, pills, sort, selected tab, expanded GUID
existing selection owner: selected entity and selection eligibility
```

Proposed files, subject to consolidation with actual existing helpers:

- `src/client/client-nearby.ts`: feature owner, session subscriptions, accepted
  membership join, local encounter metadata, and derived tracked identities.
- `src/client/client-nearby-policy.ts`: list grouping/filtering/sorting and small
  pure detection policies if splitting improves focus.
- `src/client/client-entity-alerts.ts`: colocated rule types, name matching,
  and rule validation. Keep compiled matchers runtime-only.
- `src/client/ClientNearbyPanel.svelte`: tab content and entity/rule controls.
- Colocated focused tests. Do not create a separate service per concern merely
  because this list names responsibilities.

Persisted rules need a stable rule ID, an explicit exact-name or glob match
specification, and enabled state. Each field has a consumer: editing/deletion,
matching, and enable controls respectively. Add-from-entity creates exact-name
matching so literal `*`, `?`, or backslashes never broaden a rule accidentally.
The editor makes match mode and glob escaping clear. Reject empty patterns and
duplicate equivalent rules rather than silently keeping unusable duplicates.
Define normalization once for validation, preview, and runtime matching.

Do not persist entity GUIDs, compiled matchers, active match sets, timestamps,
captured locations, or rearm state. Those belong to the current session.

## Membership and public fact policy

Nearby contains known, independently world-placed server entities other than
the local player. Exclude contained, equipped, and attached children even if
they have a resolved scene transform. Do not equate `scenePlacement=available`
with independent placement: attachments can also have it.

Use accepted identity and pose evidence rather than renderer membership. Define
the exact membership predicate at the existing authoritative relationship seam;
if the frontend contract lacks the necessary distinction, extend the shared
facts narrowly rather than reconstructing storage/attachment semantics in TS.
No new arbitrary radius is required: the roster reflects accepted nearby world
membership. Name the scope clearly and keep it independent from minimap zoom.

Preserve existing selection admission. If a listed entity cannot be acquired,
make that unavailable state explicit rather than bypassing the selection owner.

Categories are exhaustive display groups with deterministic precedence:
players, NPC/vendor, monsters, corpse/container, portal, lifestone/bindstone,
door/switch, then items/miscellaneous. Final precedence must follow proven
shared semantics, with specific identity categories winning over broad item
flags. Optional template catalog data is not required for a root category.
Do not copy the TUI's finer inventory taxonomy or its classifier wholesale.

Entity details may include:

- Public name, shared category, and a proven public subtype such as Vendor or Corpse.
- Accepted current coordinates and player-relative distance; waypoint action.
- Public stack quantity and structure where provenance is proven.
- Existing corpse opened/unopened state and shared direct-use availability.
- Locally recorded first-seen time and matching rule names/patterns.

Audit each candidate field back to its producer. Existing merged properties
may include appraisal updates; merely avoiding the inspection API is insufficient.
If a field cannot be isolated from appraisal without disproportionate work,
omit that optional field. Do not add a general property-provenance framework.

## Search, presentation, and settings

- Reuse `textSearchWords` / `matchesSearchTerms`; search only the entity name.
- Category pills use OR; Tracked and name search use AND. With no category
  selected, all categories are eligible.
- Distance sort is ascending; name uses a consistent collation; category uses
  declared pill order; first-seen sort puts newest first. GUID breaks ties.
- Build per-row distances in one pose pass, not repeated full-feed scans.
- Retain expansion by GUID across unrelated refreshes. Retire it when the entity
  is authoritatively gone. Filters may hide it without making it a new encounter.
- Reuse HUD shell retention, tabs, shared styles, icon pipeline, and keyboard
  ownership. Panel controls must not steal movement input except actual editors.
- Opening the window starts bounded display sampling; closing stops it and
  dismisses transient dialogs. Tabs retain query drafts and scrolling.
- Persist rules per character using the existing profile owner. Persist the new
  window placement using existing HUD layout settings. Query/filter/expansion
  may remain transient retained UI state; do not add preference fields gratuitously.
- Extend settings loading/defaulting deliberately so existing profiles remain
  readable. Do not silently discard malformed user rules or overwrite them.

## Detection lifecycle

A detection is an entity entering the enabled-rule match set with a usable
accepted position. Record one initial location for that encounter, then keep
current position separate for the list and minimap.

| Event | Required behavior |
| --- | --- |
| Name before pose, or pose before name | Wait until both establish a nearby match; notify once. |
| Several entities match one rule | Track each GUID, retain each initial position, count all current matches. |
| One entity matches several rules | One entity notification and marker; details list all matching rules. |
| Repeated facts or motion | Update current display facts without repeating detection. |
| Rule added/enabled | Evaluate current roster and announce newly tracked entities once. |
| Rule edited | Atomically replace matcher and recompute memberships; no duplicate notification for an entity continuously tracked by another rule. |
| Rule disabled/deleted | Remove its memberships; clear decoration only when no enabled rule remains. |
| All matching rules disabled, later enabled | Treat explicit reactivation as a new announcement opportunity. |
| Confirmed departure | Remove from current counts/markers; keep only a bounded rearm record through the grace interval. |
| Return within grace | Restore current match without repeating announcement. |
| Return after grace | New encounter; capture new initial coordinates and notify. |
| Semantic/dynamic recovery pending | Suspend detection; do not interpret a missing mirror as departures. |
| Same-session replacement snapshot | Reconcile by GUID, retain encounter suppression for surviving entities, and detect genuinely new matches. |
| New session/character/world context | Clear transient observations; load correct rules and scan current baseline when ready. |
| Portal transition | Suspend incoherent observations; reconcile accepted destination membership, without treating the transition alone as a global reset. |
| Panel closed | Detection and chat continue; panel display work stops. |

The owner must wait for character settings readiness before evaluating persisted
rules, then scan the current baseline. Delayed settings hydration must not miss
initial entities or mix characters. Bound any grace records and expire them;
do not grow a historical GUID cache indefinitely.

Batch detections over one short, named interval. Emit a compact header when
useful and preserve one name/initial-coordinate line for every entity. A single
entity can use one ordinary line. Do not merge same-name entities into a count
that loses their individual coordinates. Use the existing chat retention limits.
Cancel queued notifications when their session/character is retired. Captured
detections may still be delivered if the entity departs before the batch flush.

Coordinate formatting must respect outdoor versus interior location semantics.
Reuse the existing location/waypoint representation; do not invent outdoor
coordinates for a dungeon cell or create misleading waypoint links. If a
location cannot be expressed by the existing link contract, show accurate cell
and local coordinates as text and keep waypoint action unavailable.

## Minimap integration

Supply the current tracked GUID set through the imperative map-frame seam.
Compute match membership once in the owner; do not run rule matching inside
the minimap drawing loop. Render a distinct ring/badge that composes with
existing selected styling and category colors. Update tracked decoration even
when entity motion is unchanged but a rule is edited.

Keep the Nearby launcher client-owned. The shared minimap can expose a narrow
action snippet if needed; it must not import alert services or Client state.
Preserve footer measurements, dragging, pan/reset gestures, and Explorer usage.

## Phased implementation

### Phase 1: Public facts and membership

- [x] Audit provenance and write down the final included fields in code comments/types.
- [x] Prove independent-root membership and lifecycle signals for attachments,
  containment, removal, portal transitions, and recovery.
- [x] Extend world classification/fact contracts only for demonstrated gaps;
  propagate through core delivery and the narrow host/browser contract.
- [x] Add focused tests for category precedence, partial hydration, independent
  placement, and appraisal independence.

Acceptance: every displayed domain fact has a proven non-appraisal source;
render residency does not own membership; the touched Rust/TS contracts agree.

### Phase 2: Nearby owner and Entities UI

- [x] Add the session-scoped owner and bounded display snapshots.
- [x] Add the minimap launcher, retained HUD placement, tabs, pills, name search,
  sorting, row selection, and separate details expansion.
- [x] Use existing waypoint and selection paths with explicit unavailability.
- [x] Verify distance sampling is linear in entity count and hidden display work stops.

Acceptance: synthetic fixtures exercise all groups, duplicate names, filters,
sort ties, selection rejection, movement, departures, and hidden-window lifetime.

### Phase 3: Alert rules and detection

- [x] Add exact/glob rule contracts, validation, matching, CRUD, current preview/counts,
  and Add alert from entity rows.
- [x] Integrate character persistence and generation-safe hydration.
- [x] Implement per-entity encounters, overlapping-rule membership, rearming,
  resync reconciliation, and batched local chat.
- [x] Exercise every reachable lifecycle row above with an injected clock and
  small synthetic fact/pose fixtures.

Acceptance: multiple entities preserve distinct captured positions; overlapping
rules never duplicate an entity detection; closed UI does not stop detection;
rule reload and recovery do not mix sessions or flood chat.

### Phase 4: Integration reassessment

- [x] Reassess actual contract changes and owner size before map integration.
- [x] Remove duplicated classification or world caches exposed during execution.
- [x] Check portal/interior coordinates, late settings, and rule-edit behavior
  against real lifecycle paths. Update this plan if evidence changes defaults.

Acceptance: ownership and remaining work still match the narrow feature scope.
Escalate only material product decisions or newly proven architectural gaps.

### Phase 5: Minimap, cleanup, and verification

- [x] Add tracked decoration and rule-driven invalidation to the map frame path.
- [x] Verify coexistence with selection and existing radar visibility policy.
- [x] Remove temporary diagnostics, redundant derived fields, dead names/imports,
  and any tests requiring untracked runtime assets.
- [x] Run relevant unit tests, type checks, formatting, lint, and touched Rust checks.
- [x] Add/run noninteractive browser-harness cases for actual UI, lifecycle,
  selection, coordinate actions, and map-frame integration.

Acceptance: no errors/warnings in applicable checks; no appraisals or TUI launch;
no feature-owned listener/timer survives session disposal. Leave visual acceptance
to the user unless explicitly requested.

## Verification and definition of done

Use manifest scripts from `apps/holtburger-3d/package.json`: targeted
`npm run test:ts -- ...`, `npm run check`, applicable lint/format checks, and
`npm run harness:browser -- ...`. If Rust changes, run focused crate tests and
Clippy with warnings denied for touched crates, including shared crates as needed.
Do not run the interactive TUI or perform unsolicited visual acceptance checks.

- [x] Agreed pills and grouping are exhaustive, with deterministic precedence.
- [x] Search, sorting, expansion, and selection behave independently.
- [x] Appraisal cannot enrich the catalog or affect its matching decisions.
- [x] Every matching entity is independently represented; every detection has
  its own captured initial position.
- [x] Rules survive restart through existing settings, including older profiles.
- [x] Recovery, character changes, and disposal preserve the lifecycle invariants.
- [x] Minimap decoration preserves existing eligibility and selection behavior.
- [x] Display work is bounded and paused while hidden; alerts remain active.
- [x] Applicable automated checks and browser integration evidence pass.
- [x] No speculative shared framework, equipment hierarchy, historical database,
  or unrelated cleanup has entered the change.

## Risks and decisions to resolve during execution

- **Merged fact provenance:** prove each optional field or omit it. Do not rely
  on whichever properties happen to be retained after examination.
- **Removal versus partial delivery:** join accepted mirrors and distinguish
  confirmed loss from recovery. Preserve compact encounter state across resync.
- **Broad membership versus selection:** catalog membership does not authorize
  bypassing the existing target acquisition distance and placement rules.
- **No radar marker:** a detected item may lack a normal blip. Keep that limitation
  explicit; expanding radar visibility requires a separate decision.
- **Glob grammar and timing:** document escaping with examples in the editor,
  centralize matcher normalization, and choose named grace/batch constants during
  implementation. Add no configuration UI without demonstrated need.
- **Interior coordinates:** reuse proven location semantics; readable accurate
  text is preferable to a false world-map link.

Implementation was authorized on 2026-10-19. No major blocker or product decision
requiring user input was encountered. Visual acceptance remains user-owned.


## Implementation record — 2026-10-19

### Final ownership and decisions

- `ClientNearby` in `src/client/client-nearby.ts` is constructed/disposed by
  `ClientApp.svelte`. It consumes accepted mirrors, retains encounter metadata,
  compiles enabled rules, batches chat, and supplies tracked identities. It does
  not retain a second copy of entity facts or poses.
- Character settings publication directly supplies rules to this owner. Unrelated
  preference changes do not compile rules or rescan entities. Edits carry their
  opening character identity so stale actions cannot save into another profile.
- `ClientNearbyPanel.svelte` owns search, pills, sorting, tab selection, and row
  expansion. Its bounded display timer stops when hidden. Retained windows are
  keyed by both feature owner and character to retire old character drafts.
- The existing world classification function supplies player/NPC/monster,
  landmark, door, and switch semantics. The catalog collapses those results into
  its broad groups, adds public corpse/container distinctions, and preserves
  vendor and corpse details without reconstructing classification in TS.
- Appraisal merges into the existing general property store. Consequently,
  `crates/holtburger-world/src/entity_public_description.rs` retains only the
  small public-description subset consumed by this feature. Creation replaces
  this record; ordinary property updates amend it; identification cannot touch
  it. This record is private to world. The typed `ClientEntityFacts.nearby`
  projection exposes the independently placed public summary to the frontend.
  Existing core/host pass-through contracts carry it without a new alert API.
- Public details include stack count, independently disclosed structure bounds,
  and authored direct-use permission. They exclude appraisal-derived fields.
  Indoor locations retain cell/local coordinates; outdoor waypoint intents use
  the existing bounded surface-map constructor.
- Rules persist per character through the existing section store, with explicit
  exact/glob modes, case-insensitive whole-name matching, duplicate rejection,
  and literal wildcard preservation in exact-name additions. The matcher uses
  bounded dynamic programming rather than regex backtracking.
- Chosen timing is centralized in `CLIENT_NEARBY_TUNING`: 250 ms display sampling,
  150 ms notification batching, and 5 s confirmed-absence grace. Pattern length
  is bounded at 256 characters. None of these adds a settings UI.
- Multiple matches retain independent encounters and coordinate lines. Enabled
  rule overlap does not duplicate an entity notification. Disabling a rule also
  retires its suppression state for temporarily absent entities.
- The minimap samples the tracked set imperatively. Its new launcher is an
  app-supplied action snippet with explicit pointer admission inside the otherwise
  transparent minimap shell. The tracking ring composes with existing selected
  styling, including the distinct door-span selection path; visibility policy
  is unchanged.

### Verification evidence

| Check | Result |
| --- | --- |
| `npm run test:ts` | 372 files, 3,299 tests passed. |
| Focused alert/owner/settings tests after final lifecycle cleanup | Passed; see the focused commands in the execution notes below. |
| `npm run check` | Svelte, app/node, test, and Electron type checks passed; zero Svelte warnings. |
| `npm run lint:ts` and `npm run lint:dead` | Passed. |
| Prettier check of all changed app sources | Passed. |
| `cargo fmt --all -- --check` | Passed. |
| `cargo test -p holtburger-world` | 983 tests passed. The public-fact test was subsequently strengthened to prove exclusion of a fully resolved attachment; the focused `nearby_` suite passed again. |
| `cargo test -p holtburger-core -p holtburger-3d-host` | 670 core and 374 host tests passed, plus the remaining zero-test binary/doc targets. Local socket permission was required. |
| `cargo clippy -p holtburger-world -p holtburger-3d-host --all-targets -- -D warnings` | Passed. World Clippy passed again after strengthening the attachment fixture. |
| `npm run build` | Succeeded, with chunk-size warnings described below. |
| `npm run harness:browser -- --client-nearby` | Passed with no browser errors: fuzzy search, selection, disclosure, exact-name addition, glob preview, independent matches, two tracked rings in one canvas frame, rule-toggle redraw without motion, actual waypoint navigation, continued hidden detection, stopped hidden display sampling, retained draft, and real pointer hit testing. |
| `npm run harness:browser -- --client-hud` | Passed against settled sources. Its three warnings came from explicit missing-image/no-live-connection fixtures. |

Focused final cleanup commands:

```sh
npm run test:ts -- src/client/client-entity-alerts.test.ts src/client/client-nearby.test.ts src/client/client-character-settings-owner.test.ts electron/client-settings-store.test.ts
cargo test -p holtburger-world nearby_
```

The unit fixtures cover both identity/pose arrival orders, public identity pending
beside an already-known merged description, delayed settings, duplicate names,
overlapping rules, frozen detection positions, ordinary movement, absence grace,
reactivation during absence, resync, portal suspension, character retirement,
stale edits, timer/listener disposal, category/name/distance/first-seen ordering,
and indoor waypoint refusal. Pending entity/settings states show unavailable
counts rather than pretending that zero matches are known. Persistence tests reload character-local rules and
prove malformed sections survive unrelated saves rather than being overwritten.

### Bounded repository caveats

- Repository-wide `npm run format:check` still flags
  `src/harness/browser/client-precise-jump-probe.ts`. This file is unchanged from
  `HEAD`; formatting its exact `HEAD` contents with the same project formatter
  reproduces the difference. All changed sources pass their formatting check.
  Unrelated formatting cleanup was left outside this feature.
- Vite reports large chunks in both a clean `HEAD` build and this build. The
  baseline portal-transition chunk is about 795.64 kB; this build's is about
  795.67 kB. This feature also increases the shared object-inspection chunk from
  about 491.97 kB to 509.49 kB, crossing the existing 500 kB warning threshold.
  These are build-output sizes, not runtime performance measurements. No chunk
  threshold was raised and no bundling redesign was added to this scope.
- An earlier HUD run was invalidated by hot reload while fixture code was being
  edited. The recorded passing run used settled sources. The waypoint probe's
  character setup was also corrected before its passing run.
- No visual acceptance checks were performed. User-owned ACE/ACViewer worktree
  changes were left untouched.
